# Scrap for iPhone

The iOS app includes a Share Extension that accepts a Reel URL, movie, image, or text from the iOS share sheet. When a movie is available, the extension sends Muse Spark a compact MP4 with embedded audio and up to eight timestamped frames.

## Run with a free Apple Account

1. Open `ios/Scrap/Scrap.xcodeproj` in Xcode.
2. Select the `Scrap` project, then select the `Scrap` target.
3. Under Signing & Capabilities, choose your Personal Team.
4. Repeat for the `ScrapShareExtension` target.
5. Connect your iPhone, enable Developer Mode, select it as the run destination, and run `Scrap`.
6. Open Instagram, choose Share on a Reel, then choose Save to Scrap.

The development server must be running on the same Wi-Fi network with `HOST=0.0.0.0`. The extension currently connects to `http://Priyaas-MacBook-Pro.local:8790`. Change `ScrapAPIBaseURL` in `ScrapShareExtension/Info.plist` when using a public HTTPS backend or a different Mac.

Instagram controls what the share sheet provides. If it supplies only a URL, Scrap processes the URL and preview metadata. If it supplies a movie, Scrap sends the MP4, embedded audio, and extracted frames.
