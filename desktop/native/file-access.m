// Coordinate a single authorized file. A snapshot is copied into the private
// descriptor supplied by the parent while the provider grants access.
#import <Foundation/Foundation.h>
#import <FileProvider/NSFileProviderError.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

enum { Pending = 75, Offline = 69, NoSpace = 73, Permission = 77, Unavailable = 74 };

static int posixStatus(int code) {
    switch (code) {
        case EAGAIN: case EDEADLK: case EBUSY: case ETIMEDOUT: case ESTALE: return Pending;
        case ENETDOWN: case ENETUNREACH: case EHOSTUNREACH: case ENOTCONN: return Offline;
        case ENOSPC: case EDQUOT: return NoSpace;
        case EACCES: case EPERM: case ELOOP: return Permission;
        default: return Unavailable;
    }
}

static int coordinationStatus(NSError *error) {
    if ([error.domain isEqualToString:NSPOSIXErrorDomain]) return posixStatus((int)error.code);
    if ([error.domain isEqualToString:NSFileProviderErrorDomain]) {
        switch (error.code) {
            case NSFileProviderErrorNotAuthenticated: return Permission;
            case NSFileProviderErrorInsufficientQuota: return NoSpace;
            case NSFileProviderErrorServerUnreachable: return Offline;
        }
    } else if ([error.domain isEqualToString:NSCocoaErrorDomain]) {
        if (error.code == NSFileReadNoPermissionError) return Permission;
        if (error.code == NSFileWriteOutOfSpaceError) return NoSpace;
    } else if ([error.domain isEqualToString:NSURLErrorDomain]) {
        if (error.code == NSURLErrorNotConnectedToInternet ||
            error.code == NSURLErrorNetworkConnectionLost ||
            error.code == NSURLErrorCannotConnectToHost) return Offline;
        if (error.code == NSURLErrorTimedOut) return Pending;
    }
    NSError *underlying = error.userInfo[NSUnderlyingErrorKey];
    return underlying && underlying != error ? coordinationStatus(underlying) : Unavailable;
}

static int copyContents(int source, int target, const struct stat *before, struct stat *after) {
    char buffer[65536];
    off_t total = 0;
    for (;;) {
        ssize_t count = read(source, buffer, sizeof(buffer));
        if (count == -1 && errno == EINTR) continue;
        if (count == -1) return posixStatus(errno);
        if (!count) break;
        if (count > before->st_size - total) return Pending;
        if (target >= 0) {
            ssize_t offset = 0;
            while (offset < count) {
                ssize_t n = write(target, buffer + offset, (size_t)(count - offset));
                if (n < 0 && errno == EINTR) continue;
                if (n <= 0) return n < 0 ? posixStatus(errno) : Unavailable;
                offset += n;
            }
        }
        total += count;
    }
    if (fstat(source, after) != 0) return posixStatus(errno);
    if (total != before->st_size || total != after->st_size ||
        before->st_mtimespec.tv_sec != after->st_mtimespec.tv_sec ||
        before->st_mtimespec.tv_nsec != after->st_mtimespec.tv_nsec ||
        before->st_ctimespec.tv_sec != after->st_ctimespec.tv_sec ||
        before->st_ctimespec.tv_nsec != after->st_ctimespec.tv_nsec) return Pending;
    return 0;
}

static void reportStat(const struct stat *s) {
    // The control channel carries only numbers from the descriptor that was read.
    NSArray *record = @[@(s->st_mode), @(s->st_ino), @(s->st_dev), @(s->st_nlink),
        @(s->st_uid), @(s->st_gid), @(s->st_size),
        @(s->st_atimespec.tv_sec), @(s->st_atimespec.tv_nsec),
        @(s->st_mtimespec.tv_sec), @(s->st_mtimespec.tv_nsec),
        @(s->st_ctimespec.tv_sec), @(s->st_ctimespec.tv_nsec),
        @(s->st_flags), @(s->st_blocks), @(s->st_blksize), @(s->st_rdev),
        @(s->st_gen), @(s->st_birthtimespec.tv_sec), @(s->st_birthtimespec.tv_nsec)];
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stderr);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL snapshot = argc == 3 && strcmp(argv[2], "--snapshot") == 0;
        if ((argc != 2 && !snapshot) || argv[1][0] != '/') return 64;
        NSString *path = [[NSFileManager defaultManager]
            stringWithFileSystemRepresentation:argv[1] length:strlen(argv[1])];
        if (!path || [path.pathComponents containsObject:@".."]) return Permission;
        // Hold the authorized directory without opening any file data before
        // coordination. File Provider may replace the placeholder inode while
        // satisfying the request; validate the actual grant against this name.
        NSString *name = path.lastPathComponent;
        int directory = open(path.stringByDeletingLastPathComponent.fileSystemRepresentation,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW_ANY);
        if (directory < 0) return errno == ENOENT ? 66 : posixStatus(errno);
        struct stat entry;
        if (fstatat(directory, name.fileSystemRepresentation, &entry, AT_SYMLINK_NOFOLLOW) != 0) {
            int status = errno == ENOENT ? 66 : posixStatus(errno);
            close(directory);
            return status;
        }
        if (!S_ISREG(entry.st_mode)) { close(directory); return 66; }
        NSURL *url = [NSURL fileURLWithPath:path];
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        NSError *error = nil;
        __block int result = Unavailable;
        __block struct stat completed;
        [coordinator coordinateReadingItemAtURL:url options:0 error:&error byAccessor:^(NSURL *granted) {
            int fd = open(granted.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW_ANY | O_NONBLOCK);
            if (fd < 0) { result = posixStatus(errno); return; }
            struct stat expected, opened;
            if (fstatat(directory, name.fileSystemRepresentation, &expected, AT_SYMLINK_NOFOLLOW) != 0 ||
                fstat(fd, &opened) != 0) result = posixStatus(errno);
            else if (!S_ISREG(opened.st_mode) || opened.st_dev != expected.st_dev ||
                     opened.st_ino != expected.st_ino) result = Pending;
            else if (opened.st_size == 0 && (entry.st_size > 0 || (opened.st_flags & SF_DATALESS))) result = Pending;
            else result = copyContents(fd, snapshot ? STDOUT_FILENO : -1, &opened, &completed);
            close(fd);
        }];
        close(directory);
        if (error) return coordinationStatus(error);
        if (result) return result;
        if (snapshot) reportStat(&completed);
        else fputs("{\"status\":\"materialized\"}\n", stdout);
        return 0;
    }
}
