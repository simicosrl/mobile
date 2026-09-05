package com.simico.warehousescan;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Every CSS/JS-level attempt at the "screen goes blank behind the
        // keyboard" bug (viewport meta tags, forcing the page height via
        // window.visualViewport) changed nothing — the DOM stays correct
        // underneath (typing works, content reappears once the keyboard
        // closes), only the on-screen repaint is missing. That pattern
        // points to Chromium's hardware-accelerated compositor failing to
        // invalidate/redraw its layers when only the IME inset changes —
        // a known class of WebView rendering bug, not a layout bug, and
        // CSS/JS can't reach it since the browser-side content is already
        // correct.
        //
        // Forcing the WebView onto Android's software rendering path
        // sidesteps that GPU-compositor bug entirely (at some cost to
        // scroll/animation smoothness, which is an acceptable trade-off
        // for a warehouse scanning app). This is the standard fix cited
        // across Capacitor/Cordova WebView apps for this exact symptom.
        View webView = getBridge().getWebView();
        if (webView != null) {
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
    }
}
