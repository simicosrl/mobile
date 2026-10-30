package com.simico.warehousescan;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HardwareScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
