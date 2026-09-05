package com.simico.warehousescan;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must run before any WebView is created (which happens inside
        // BridgeActivity's own onCreate, via super below) — this is
        // Android's own documented workaround for a WebView compositing
        // bug where a layout change mid-draw (exactly what
        // windowSoftInputMode="adjustResize" triggers every time the
        // keyboard opens/closes) leaves the WebView showing a blank/stale
        // frame until the next full repaint, even though the DOM
        // underneath is already correct — matching the "typing works, but
        // the screen goes white until you submit" symptom reported here.
        WebView.enableSlowWholeDocumentDraw();
        super.onCreate(savedInstanceState);
    }
}
