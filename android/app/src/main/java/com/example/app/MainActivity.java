package com.example.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // This listener correctly applies the top margin to avoid the status bar.
    ViewCompat.setOnApplyWindowInsetsListener(
      findViewById(android.R.id.content),
      (v, insets) -> {
        int statusBarHeight = insets.getInsets(
          WindowInsetsCompat.Type.statusBars()
        ).top;
        WebView webView = getBridge().getWebView();
        ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
        if (params != null) {
          params.topMargin = statusBarHeight;
          webView.setLayoutParams(params);
        }
        return insets;
      }
    );
  }

  @Override
  public void onBackPressed() {
    WebView webView = getBridge().getWebView();
    if (webView.canGoBack()) {
      webView.goBack();
    } else {
      super.onBackPressed();
    }
  }
}