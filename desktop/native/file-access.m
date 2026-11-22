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

static int openReadDirectory(NSString *path, int *directory, struct stat *entry) {
    // Pin the authorized name without opening file data before coordination.
    int fd = open(path.stringByDeletingLastPathComponent.fileSystemRepresentation,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW_ANY);
    if (fd < 0) return errno == ENOENT ? 66 : posixStatus(errno);
    int status = 0;
    if (fstatat(fd, path.lastPathComponent.fileSystemRepresentation, entry, AT_SYMLINK_NOFOLLOW) != 0)
        status = errno == ENOENT ? 66 : posixStatus(errno);
    else if (!S_ISREG(entry->st_mode)) status = 66;
    if (status) close(fd);
    else *directory = fd;
    return status;
}

static BOOL sameRevision(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
        a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec &&
        a->st_flags == b->st_flags;
}

static int readGranted(NSURL *granted, NSString *name, int directory, const struct stat *entry,
                       int target, BOOL cached, struct stat *completed) {
    if (!granted.isFileURL) return Unavailable;
    int fd = open(granted.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW_ANY | O_NONBLOCK);
    if (fd < 0) return posixStatus(errno);
    struct stat expected, opened;
    int status;
    if (fstatat(directory, name.fileSystemRepresentation, &expected, AT_SYMLINK_NOFOLLOW) != 0 ||
        fstat(fd, &opened) != 0) status = posixStatus(errno);
    else if (!S_ISREG(opened.st_mode) || opened.st_dev != expected.st_dev || opened.st_ino != expected.st_ino)
        status = Pending;
    else if (cached && ((opened.st_flags & SF_DATALESS) || !sameRevision(entry, &opened))) status = Pending;
    else if (opened.st_size == 0 && (entry->st_size > 0 || (opened.st_flags & SF_DATALESS))) status = Pending;
    else {
        status = copyContents(fd, target, &opened, completed);
        if (!status && cached && !sameRevision(&opened, completed)) status = Pending;
    }
    if (close(fd) != 0 && !status) status = posixStatus(errno);
    return status;
}

static int coordinateRead(const char *file, int target, struct stat *completed) {
    NSString *path = [[NSFileManager defaultManager]
        stringWithFileSystemRepresentation:file length:strlen(file)];
    if (!path || [path.pathComponents containsObject:@".."]) return Permission;
    int directory;
    struct stat entry;
    int status = openReadDirectory(path, &directory, &entry);
    if (status) return status;
    NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
    NSError *error = nil;
    __block int result = Unavailable;
    [coordinator coordinateReadingItemAtURL:[NSURL fileURLWithPath:path] options:0 error:&error byAccessor:^(NSURL *granted) {
        // File Provider may replace a placeholder while satisfying an ordinary read.
        result = readGranted(granted, path.lastPathComponent, directory, &entry, target, NO, completed);
    }];
    if (close(directory) != 0 && !result) result = posixStatus(errno);
    return error ? coordinationStatus(error) : result;
}

enum { MaxSkillSources = 256, MaxRequestBytes = MaxSkillSources * (6 * PATH_MAX + 8) };

static NSString *skillSourceRoot(id item) {
    if (![item isKindOfClass:[NSString class]]) return nil;
    NSString *path = item;
    char file[PATH_MAX];
    if (![path hasPrefix:@"/"] || ![path getFileSystemRepresentation:file maxLength:sizeof(file)] ||
        [path rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0, 1)]].location != NSNotFound)
        return nil;
    NSArray<NSString *> *parts = [path componentsSeparatedByString:@"/"];
    NSUInteger n = parts.count;
    if (n < 6 || [parts containsObject:@".."] || [parts containsObject:@"."] || [path containsString:@"//"] ||
        (![parts[n-1] isEqualToString:@"skill.yaml"] && ![parts[n-1] isEqualToString:@"SKILL.md"]) ||
        ![parts[n-3] isEqualToString:@"skills"] || ![parts[n-4] isEqualToString:@"agent"] ||
        ![parts[n-5] isEqualToString:@".gnosi"]) return nil;
    NSString *package = parts[n-2];
    if ([package rangeOfString:@"\\Auser\\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\\z"
                       options:NSRegularExpressionSearch].location == NSNotFound) return nil;
    return path.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
}

typedef struct { int directory; struct stat before, completed; } SkillSource;

static int verifySkillSources(void) {
    NSMutableData *data = [NSMutableData data];
    char chunk[8192];
    for (;;) {
        ssize_t count = read(STDIN_FILENO, chunk, sizeof(chunk));
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) return posixStatus(errno);
        if (!count) break;
        if (data.length + (NSUInteger)count > MaxRequestBytes) return 64;
        [data appendBytes:chunk length:(NSUInteger)count];
    }
    NSArray<NSString *> *paths = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if (![paths isKindOfClass:[NSArray class]] || !paths.count || paths.count > MaxSkillSources) return 64;
    NSMutableArray<NSFileAccessIntent *> *intents = [NSMutableArray arrayWithCapacity:paths.count];
    NSString *root = nil;
    for (id path in paths) {
        NSString *candidate = skillSourceRoot(path);
        if (!candidate || (root && ![candidate isEqualToString:root])) return 64;
        root = candidate;
        [intents addObject:[NSFileAccessIntent readingIntentWithURL:[NSURL fileURLWithPath:path] options:0]];
    }
    SkillSource *sources = calloc(paths.count, sizeof(*sources));
    if (!sources) return Unavailable;
    NSUInteger opened = 0;
    __block int status = 0;
    for (NSString *path in paths) {
        SkillSource *source = &sources[opened];
        status = openReadDirectory(path, &source->directory, &source->before);
        if (status) break;
        ++opened;
        if (source->before.st_flags & SF_DATALESS) { status = Pending; break; }
    }
    if (!status) {
        NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
        dispatch_semaphore_t finished = dispatch_semaphore_create(0);
        [coordinator coordinateAccessWithIntents:intents queue:[[NSOperationQueue alloc] init] byAccessor:^(NSError *error) {
            status = error ? coordinationStatus(error) : 0;
            for (NSUInteger i = 0; !status && i < paths.count; ++i) {
                SkillSource *source = &sources[i];
                status = readGranted(intents[i].URL, paths[i].lastPathComponent, source->directory,
                                     &source->before, -1, YES, &source->completed);
            }
            // Reopen every authorized parent while the grouped grant is held. A rename,
            // permission change, or uncoordinated write to an earlier source invalidates the set.
            for (NSUInteger i = 0; !status && i < paths.count; ++i) {
                int directory;
                struct stat entry, priorDirectory, currentDirectory;
                status = openReadDirectory(paths[i], &directory, &entry);
                if (status) break;
                if (fstat(sources[i].directory, &priorDirectory) || fstat(directory, &currentDirectory))
                    status = posixStatus(errno);
                else if (priorDirectory.st_dev != currentDirectory.st_dev || priorDirectory.st_ino != currentDirectory.st_ino ||
                         !sameRevision(&sources[i].completed, &entry)) status = Pending;
                if (close(directory) != 0 && !status) status = posixStatus(errno);
            }
            dispatch_semaphore_signal(finished);
        }];
        dispatch_semaphore_wait(finished, DISPATCH_TIME_FOREVER);
    }
    for (NSUInteger i = 0; i < opened; ++i)
        if (close(sources[i].directory) != 0 && !status) status = posixStatus(errno);
    NSMutableArray *records = [NSMutableArray arrayWithCapacity:paths.count];
    if (!status)
        for (NSUInteger i = 0; i < paths.count; ++i) [records addObject:statFields(&sources[i].completed)];
    free(sources);
    if (status) return status;
    NSData *reply = [NSJSONSerialization dataWithJSONObject:records options:0 error:NULL];
    return reply ? writeAll(STDOUT_FILENO, reply.bytes, reply.length) : Unavailable;
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
        if (argc == 2 && strcmp(argv[1], "--verify-skill-sources") == 0) return verifySkillSources();
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
