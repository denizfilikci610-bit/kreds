import WebKit

/// Serves the currently-staged memory media (photo/video) to the web page over a custom URL scheme,
/// so a natively-picked photo/video reaches the web (which uploads it via the existing Supabase path)
/// WITHOUT a huge base64 evaluateJavaScript payload. The web does `fetch('vfmedia://current')` → blob.
final class VFMediaScheme: NSObject, WKURLSchemeHandler {
    static let shared = VFMediaScheme()
    static let scheme = "vfmedia"

    private var data: Data?
    private var mime = "application/octet-stream"

    func stage(_ data: Data, mime: String) { self.data = data; self.mime = mime }
    func clear() { data = nil }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let payload = data ?? Data()
        let headers = [
            "Content-Type": mime,
            "Content-Length": "\(payload.count)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        ]
        guard let url = task.request.url,
              let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badURL)); return
        }
        task.didReceive(resp)
        task.didReceive(payload)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
