// Coordinate a single authorized file. A snapshot is copied into the private
// descriptor supplied by the parent while the provider grants access.
#import <Foundation/Foundation.h>
#import <FileProvider/NSFileProviderError.h>
#include <arpa/inet.h>
#include <dispatch/dispatch.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <sys/socket.h>
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

static int writeAll(int target, const void *data, size_t length) {
    const char *bytes = data;
    while (length) {
        ssize_t count = write(target, bytes, length);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return count < 0 ? posixStatus(errno) : Unavailable;
        bytes += count;
        length -= (size_t)count;
    }
    return 0;
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
            int result = writeAll(target, buffer, (size_t)count);
            if (result) return result;
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

static NSArray *statFields(const struct stat *s) {
    // The control channel carries only numbers from the descriptor that was read.
    return @[@(s->st_mode), @(s->st_ino), @(s->st_dev), @(s->st_nlink),
        @(s->st_uid), @(s->st_gid), @(s->st_size),
        @(s->st_atimespec.tv_sec), @(s->st_atimespec.tv_nsec),
        @(s->st_mtimespec.tv_sec), @(s->st_mtimespec.tv_nsec),
        @(s->st_ctimespec.tv_sec), @(s->st_ctimespec.tv_nsec),
        @(s->st_flags), @(s->st_blocks), @(s->st_blksize), @(s->st_rdev),
        @(s->st_gen), @(s->st_birthtimespec.tv_sec), @(s->st_birthtimespec.tv_nsec)];
}

static int coordinateRead(const char *file, int target, struct stat *completed) {
    NSString *path = [[NSFileManager defaultManager]
        stringWithFileSystemRepresentation:file length:strlen(file)];
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
    [coordinator coordinateReadingItemAtURL:url options:0 error:&error byAccessor:^(NSURL *granted) {
        int fd = open(granted.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW_ANY | O_NONBLOCK);
        if (fd < 0) { result = posixStatus(errno); return; }
        struct stat expected, opened;
        if (fstatat(directory, name.fileSystemRepresentation, &expected, AT_SYMLINK_NOFOLLOW) != 0 ||
            fstat(fd, &opened) != 0) result = posixStatus(errno);
        else if (!S_ISREG(opened.st_mode) || opened.st_dev != expected.st_dev ||
                 opened.st_ino != expected.st_ino) result = Pending;
        else if (opened.st_size == 0 && (entry.st_size > 0 || (opened.st_flags & SF_DATALESS))) result = Pending;
        else result = copyContents(fd, target, &opened, completed);
        close(fd);
    }];
    close(directory);
    return error ? coordinationStatus(error) : result;
}

// The protocol uses ancillary data only on the one-byte request marker. Also
// use recvmsg for the payload to detect and close a descriptor sent there.
static ssize_t receiveChunk(int channel, void *bytes, size_t size, int *target) {
    union { struct cmsghdr header; char bytes[CMSG_SPACE(sizeof(int))]; } control;
    struct iovec buffer = { .iov_base = bytes, .iov_len = size };
    struct msghdr message = {
        .msg_iov = &buffer, .msg_iovlen = 1, .msg_control = control.bytes,
        .msg_controllen = CMSG_LEN(sizeof(int)), // Room for exactly one descriptor.
    };
    ssize_t count;
    do { count = recvmsg(channel, &message, 0); } while (count < 0 && errno == EINTR);
    if (count < 0) return -1;

    int passed = -1;
    struct cmsghdr *header = CMSG_FIRSTHDR(&message);
    if (header && header->cmsg_level == SOL_SOCKET && header->cmsg_type == SCM_RIGHTS &&
        header->cmsg_len >= CMSG_LEN(sizeof(int)) && message.msg_controllen >= CMSG_LEN(sizeof(int))) {
        memcpy(&passed, CMSG_DATA(header), sizeof(passed));
    }
    BOOL expected = count > 0 && target != NULL;
    if ((message.msg_flags & (MSG_CTRUNC | MSG_TRUNC)) ||
        (header && (passed < 0 || header->cmsg_len != CMSG_LEN(sizeof(int)))) ||
        (passed >= 0) != expected) {
        if (passed >= 0) close(passed);
        return -1;
    }
    if (expected) *target = passed;
    return count;
}

static BOOL receiveAll(int channel, char *bytes, size_t length) {
    while (length) {
        ssize_t count = receiveChunk(channel, bytes, length, NULL);
        if (count <= 0) return NO;
        bytes += count;
        length -= (size_t)count;
    }
    return YES;
}

static BOOL receivePath(int channel, char *path) {
    uint16_t encoded;
    if (!receiveAll(channel, (char *)&encoded, sizeof(encoded))) return NO;
    size_t length = ntohs(encoded);
    if (length == 0 || length > PATH_MAX || !receiveAll(channel, path, length)) return NO;
    if (path[0] != '/' || memchr(path, 0, length)) return NO;
    path[length] = 0;
    return YES;
}

static BOOL isSnapshotTarget(int target) {
    struct stat info;
    int flags = fcntl(target, F_GETFL);
    return flags >= 0 && (flags & O_ACCMODE) != O_RDONLY &&
        fstat(target, &info) == 0 && S_ISREG(info.st_mode) &&
        info.st_size == 0 && lseek(target, 0, SEEK_CUR) == 0;
}

static int serveRequests(int channel) {
    if (writeAll(channel, "GNS1", 4)) return Unavailable;
    for (;;) {
        @autoreleasepool {
            char marker, path[PATH_MAX + 1];
            int target = -1;
            ssize_t count = receiveChunk(channel, &marker, 1, &target);
            if (count <= 0) return count == 0 ? 0 : 64;
            if (marker != 'R' || !isSnapshotTarget(target) || !receivePath(channel, path)) {
                close(target);
                return 64;
            }
            struct stat completed;
            int status = coordinateRead(path, target, &completed);
            close(target);
            NSArray *record = @[@(status), status ? [NSNull null] : statFields(&completed)];
            NSMutableData *reply = [[NSJSONSerialization dataWithJSONObject:record options:0 error:NULL] mutableCopy];
            if (!reply) return Unavailable;
            [reply appendBytes:"\n" length:1];
            if (writeAll(channel, reply.bytes, reply.length)) return Unavailable;
        }
    }
}

static int runWorker(int channel) {
    struct sockaddr_storage address;
    socklen_t addressLength = sizeof(address);
    int type, enabled = 1;
    socklen_t typeLength = sizeof(type);
    if (getsockname(channel, (struct sockaddr *)&address, &addressLength) != 0 || address.ss_family != AF_UNIX ||
        getsockopt(channel, SOL_SOCKET, SO_TYPE, &type, &typeLength) != 0 || type != SOCK_STREAM ||
        setsockopt(channel, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled)) != 0) return 64;

    // The backend enforces the deadline. If it dies while the coordinator is
    // blocked, the worker cannot observe socket EOF from its request loop.
    pid_t parent = getppid();
    if (parent <= 1) return Unavailable;
    dispatch_source_t owner = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, (uintptr_t)parent,
        DISPATCH_PROC_EXIT, dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0));
    if (!owner) return Unavailable;
    dispatch_source_set_event_handler(owner, ^{ _exit(0); });
    dispatch_source_set_registration_handler(owner, ^{
        if (getppid() != parent) _exit(0);
    });
    dispatch_activate(owner);
    int status = serveRequests(channel);
    dispatch_source_cancel(owner);
    return status;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--worker") == 0) return runWorker(STDIN_FILENO);
        BOOL snapshot = argc == 3 && strcmp(argv[2], "--snapshot") == 0;
        if ((argc != 2 && !snapshot) || argv[1][0] != '/') return 64;
        struct stat completed;
        int status = coordinateRead(argv[1], snapshot ? STDOUT_FILENO : -1, &completed);
        if (status) return status;
        if (snapshot) {
            NSData *data = [NSJSONSerialization dataWithJSONObject:statFields(&completed) options:0 error:NULL];
            fwrite(data.bytes, 1, data.length, stderr);
        } else fputs("{\"status\":\"materialized\"}\n", stdout);
        return 0;
    }
}
