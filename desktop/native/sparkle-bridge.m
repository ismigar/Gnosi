#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>

// Electron's main thread owns this bridge. Events are drained by the existing
// Koffi binding, so no JavaScript runs reentrantly inside an AppKit callback.
static NSMutableArray<NSDictionary *> *events;
static NSString *lastEvent;
static SPUUpdater *updater;
static void emit(NSDictionary *event) {
    if (!events) events = [NSMutableArray new];
    if ([event[@"type"] isEqual:@"download-progress"] &&
        [events.lastObject[@"type"] isEqual:@"download-progress"]) [events removeLastObject];
    [events addObject:event];
}

@interface GnosiUpdateDriver : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property(copy) void (^downloadReply)(SPUUserUpdateChoice);
@property(copy) void (^installReply)(SPUUserUpdateChoice);
@property(copy) NSString *version;
@property uint64_t received;
@property uint64_t expected;
@end

static GnosiUpdateDriver *driver;

@implementation GnosiUpdateDriver
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
    reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {
    emit(@{@"type": @"checking-for-update"});
}
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
    if (item.informationOnlyUpdate || state.stage != SPUUserUpdateStageNotDownloaded) {
        reply(SPUUserUpdateChoiceDismiss);
        emit(@{@"type": @"error", @"message": @"This update requires a fresh update check."});
        return;
    }
    self.version = item.displayVersionString;
    self.downloadReply = reply;
    emit(@{@"type": @"update-available", @"version": self.version});
    // Hold Sparkle's continuation until the user presses Gnosi's Update button.
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
    self.downloadReply = nil; self.installReply = nil;
    emit(@{@"type": @"update-not-available"});
    acknowledgement();
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
    self.downloadReply = nil; self.installReply = nil;
    emit(@{@"type": @"error", @"message": error.localizedDescription});
    acknowledgement();
}
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
    self.received = 0; self.expected = 0;
}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length { self.expected = length; }
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
    self.received += length;
    emit(@{@"type": @"download-progress", @"percent": @(self.expected ? MIN(100.0, 100.0 * self.received / self.expected) : 0)});
}
- (void)showDownloadDidStartExtractingUpdate {
    emit(@{@"type": @"download-progress", @"percent": @100});
}
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
    self.installReply = reply;
    emit(@{@"type": @"update-downloaded", @"version": self.version});
    // The main process must stop the backend before invoking this continuation.
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {
    // Electron may still be handling before-quit. Sparkle retains its normal
    // termination timeout; never kill a process or override unsaved-work vetoes.
}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)dismissUpdateInstallation { self.downloadReply = nil; self.installReply = nil; }
- (void)showUpdateInFocus {}
- (BOOL)updater:(SPUUpdater *)sender shouldDownloadReleaseNotesForUpdate:(SUAppcastItem *)item { return NO; }
@end

int gnosi_sparkle_start(void) {
    if (![NSThread isMainThread]) return 0;
    if (updater) return 1;
    NSBundle *bundle = NSBundle.mainBundle;
    NSDictionary *info = bundle.infoDictionary;
    // The public key and feed must come from the installed application itself.
    if ([info[@"SUPublicEDKey"] length] != 44 || ![info[@"SURequireSignedFeed"] boolValue] ||
        ![info[@"SUVerifyUpdateBeforeExtraction"] boolValue]) return 0;
    driver = [GnosiUpdateDriver new];
    updater = [[SPUUpdater alloc] initWithHostBundle:bundle applicationBundle:bundle userDriver:driver delegate:driver];
    updater.automaticallyChecksForUpdates = NO;
    updater.automaticallyDownloadsUpdates = NO;
    updater.sendsSystemProfile = NO;
    NSError *error = nil;
    if (![updater startUpdater:&error]) {
        emit(@{@"type": @"error", @"message": error.localizedDescription ?: @"Could not initialize Sparkle."});
        updater = nil; driver = nil;
        return 0;
    }
    return 1;
}

int gnosi_sparkle_check(void) {
    if (![NSThread isMainThread] || !updater.canCheckForUpdates) return 0;
    [updater checkForUpdates];
    return 1;
}

int gnosi_sparkle_download(void) {
    if (![NSThread isMainThread] || !driver.downloadReply) return 0;
    void (^reply)(SPUUserUpdateChoice) = driver.downloadReply;
    driver.downloadReply = nil;
    reply(SPUUserUpdateChoiceInstall);
    return 1;
}

int gnosi_sparkle_install(void) {
    if (![NSThread isMainThread] || !driver.installReply) return 0;
    void (^reply)(SPUUserUpdateChoice) = driver.installReply;
    driver.installReply = nil;
    reply(SPUUserUpdateChoiceInstall);
    return 1;
}

int gnosi_sparkle_ready(void) {
    return [NSThread isMainThread] && driver.installReply != nil;
}

const char *gnosi_sparkle_next_event(void) {
    if (![NSThread isMainThread] || events.count == 0) return NULL;
    NSData *json = [NSJSONSerialization dataWithJSONObject:events.firstObject options:0 error:nil];
    [events removeObjectAtIndex:0];
    lastEvent = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    return lastEvent.UTF8String;
}
