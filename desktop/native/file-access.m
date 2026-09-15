// Read-only File Provider materialization. No GUI apps, pinning or recursive reads.
#import <Foundation/Foundation.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2 || argv[1][0] != '/') return 64;
    NSString *path = [[NSFileManager defaultManager]
      stringWithFileSystemRepresentation:argv[1] length:strlen(argv[1])];
    struct stat info;
    // Callers authorize the target before invoking us. Refuse directories and
    // file symlinks so a requested file cannot turn into a recursive download.
    if (lstat(argv[1], &info) != 0 || !S_ISREG(info.st_mode)) return 66;
    NSURL *url = [NSURL fileURLWithPath:path];
    NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
    NSError *error = nil;
    __block BOOL readable = NO;
    [coordinator coordinateReadingItemAtURL:url options:0 error:&error
      byAccessor:^(NSURL *coordinatedURL) {
        int fd = open(coordinatedURL.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
        if (fd < 0) return;
        char buffer[65536];
        // A bounded read requests the contents from the provider. Never load
        // a whole attachment into memory or send document bytes over stdout.
        readable = read(fd, buffer, sizeof(buffer)) >= 0;
        close(fd);
      }];
    if (error || !readable) {
      fputs("{\"status\":\"unavailable\"}\n", stdout);
      return 74;
    }
    fputs("{\"status\":\"materialized\"}\n", stdout);
    return 0;
  }
}
