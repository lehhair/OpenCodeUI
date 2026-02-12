package com.opencodeui.app

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {

  private val handler = Handler(Looper.getMainLooper())
  private var cachedInsetsJs: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 设置状态栏图标颜色随主题自适应
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    val isNight = (resources.configuration.uiMode and
        android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES
    controller.isAppearanceLightStatusBars = !isNight
    controller.isAppearanceLightNavigationBars = !isNight

    // 监听 WindowInsets 变化，获取真实的安全区域并注入 CSS 变量
    val rootView = window.decorView.findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { _, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )

      val density = resources.displayMetrics.density
      val topDp = insets.top / density
      val bottomDp = insets.bottom / density
      val leftDp = insets.left / density
      val rightDp = insets.right / density

      cachedInsetsJs = """
        (function() {
          var s = document.documentElement.style;
          s.setProperty('--safe-area-inset-top', '${topDp}px');
          s.setProperty('--safe-area-inset-bottom', '${bottomDp}px');
          s.setProperty('--safe-area-inset-left', '${leftDp}px');
          s.setProperty('--safe-area-inset-right', '${rightDp}px');
        })();
      """.trimIndent()

      // 立即尝试注入
      tryInjectInsets(rootView)

      windowInsets
    }

    // WebView 可能还没创建好，轮询几次确保注入成功
    scheduleInsetsInjection(rootView, 0)
  }

  /**
   * 延迟重试注入 insets，确保 WebView 加载完成后 CSS 变量被设置
   * 最多重试 10 次，间隔递增
   */
  private fun scheduleInsetsInjection(rootView: View, attempt: Int) {
    if (attempt >= 10) return
    val delay = if (attempt < 3) 200L else 1000L
    handler.postDelayed({
      if (tryInjectInsets(rootView)) {
        // 注入成功后再补几次，确保页面导航后也有值
        if (attempt < 5) {
          scheduleInsetsInjection(rootView, attempt + 1)
        }
      } else {
        scheduleInsetsInjection(rootView, attempt + 1)
      }
    }, delay)
  }

  /**
   * 尝试向 WebView 注入 insets CSS 变量
   * @return 是否找到了 WebView 并成功注入
   */
  private fun tryInjectInsets(view: View): Boolean {
    val js = cachedInsetsJs ?: return false
    val webView = findWebView(view) ?: return false
    webView.evaluateJavascript(js, null)
    return true
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findWebView(view.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
