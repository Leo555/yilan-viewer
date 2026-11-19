#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DownloadTask : NSObject
@property (nonatomic, copy, readonly) NSURL *url;
@property (nonatomic, assign, readonly) double progress;
- (instancetype)initWithURL:(NSURL *)url NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (void)startWithCompletion:(void (^)(NSData *_Nullable data, NSError *_Nullable error))completion;
@end

NS_ASSUME_NONNULL_END

@implementation DownloadTask

- (instancetype)initWithURL:(NSURL *)url {
    if (self = [super init]) {
        _url = [url copy];
        _progress = 0;
    }
    return self;
}

- (void)startWithCompletion:(void (^)(NSData *, NSError *))completion {
    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithURL:self.url
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            self->_progress = 1.0;
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(data, error);
            });
        }];
    [task resume];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        DownloadTask *task = [[DownloadTask alloc] initWithURL:[NSURL URLWithString:@"https://example.com"]];
        [task startWithCompletion:^(NSData *data, NSError *error) {
            NSLog(@"收到 %lu 字节，错误：%@", (unsigned long)data.length, error);
            exit(0);
        }];
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
