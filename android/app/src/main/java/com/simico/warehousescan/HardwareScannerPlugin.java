package com.simico.warehousescan;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;

/**
 * Receives laser scans that a PDA's scan service sends as a broadcast instead
 * of typing them into the focused field. Zebra types (DataWedge keystroke
 * output), but many Android PDAs (Arrvel, Urovo, iData, Newland, Chainway…)
 * deliver scans as an Intent, which a web page never sees. Each scan is
 * passed to the web app as a "scan" event.
 *
 * The scan service can also be pointed at this app's own action,
 * com.simico.warehousescan.SCAN, with the code in the "data" extra.
 */
@CapacitorPlugin(name = "HardwareScanner")
public class HardwareScannerPlugin extends Plugin {

    // Broadcast actions used by common PDA scan services.
    private static final String[] ACTIONS = {
        "com.simico.warehousescan.SCAN",
        "android.intent.ACTION_DECODE_DATA",                // Urovo and many OEM scan services
        "com.android.server.scannerservice.broadcast",      // Seuic, many MTK PDAs
        "android.intent.action.SCANRESULT",                 // iData
        "nlscan.action.SCANNER_RESULT",                     // Newland
        "com.scanner.broadcast",                            // Chainway
        "com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED",      // Sunmi
        "com.honeywell.decode.intent.action.EDIT_DATA",     // Honeywell (intent output)
        "scan.rcv.message",                                 // Generic Chinese PDAs
        "com.barcode.sendBroadcast",                        // Generic Chinese PDAs
        "com.android.scanner.ACTION_DATA_CODE_RECEIVED",
        "android.intent.action.SCANNER_RESULT",
        "com.ehsy.warehouse.action.BARCODE_DATA",
        "android.scanservice.action.SCAN_RESULT",
    };

    // Extras that carry the code, by vendor.
    private static final String[] KEYS = {
        "data", "barcode_string", "scannerdata", "value", "SCAN_BARCODE1", "barcodeData",
        "barcode", "barocode", "scan_data", "SCAN_DATA", "decode_data", "barcodedata", "code",
        "EXTRA_BARCODE_DECODING_DATA", "result", "text",
    };

    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String code = extract(intent);
                JSObject ev = new JSObject();
                ev.put("action", intent.getAction());
                ev.put("keys", intent.getExtras() != null ? intent.getExtras().keySet().toString() : "[]");
                if (code != null) ev.put("code", code);
                notifyListeners("scan", ev, true);
            }
        };
        IntentFilter filter = new IntentFilter();
        for (String a : ACTIONS) filter.addAction(a);
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
            receiver = null;
        }
    }

    private static String extract(Intent intent) {
        Bundle extras = intent.getExtras();
        if (extras == null) return null;
        for (String k : KEYS) {
            String s = asText(extras, k);
            if (s != null) return s;
        }
        // Unknown vendor: the first non-empty text extra.
        for (String k : extras.keySet()) {
            String s = asText(extras, k);
            if (s != null) return s;
        }
        return null;
    }

    private static String asText(Bundle extras, String key) {
        Object v = extras.get(key);
        String s = null;
        if (v instanceof String) {
            s = (String) v;
        } else if (v instanceof byte[]) {
            byte[] b = (byte[]) v;
            int len = extras.getInt("length", b.length);
            if (len <= 0 || len > b.length) len = b.length;
            s = new String(b, 0, len, StandardCharsets.UTF_8);
        }
        if (s == null) return null;
        s = s.trim();
        return s.isEmpty() ? null : s;
    }
}
