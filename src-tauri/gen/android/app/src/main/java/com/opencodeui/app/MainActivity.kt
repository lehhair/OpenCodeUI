package com.opencodeui.app

import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {

  private val handler = Handler(Looper.getMainLooper())
  private var cachedInsetsJs: String? = null
  private var themeSyncRunnable: Runnable? = null
  private var cachedWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 初始状态栏样式（后续由 WebView 主题同步驱动）
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = true
    controller.isAppearanceLightNavigationBars = true

    // 禁用系统对比度强制（避免状态栏自动加黑/渐变）
    if (Build.VERSION.SDK_INT >= 29) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // 监听 WindowInsets 变化：
    // 1. 对内容容器 setPadding，让 WebView 物理 resize（键盘弹出时 window.innerHeight 自动变小）
    // 2. 注入 CSS 变量供前端做精细布局
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, windowInsets ->
      val systemInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime())

      // 键盘弹出时底部取 IME 和系统栏的较大值，让 WebView 整体 resize
      val bottomPadding = maxOf(imeInsets.bottom, systemInsets.bottom)
      view.setPadding(
        systemInsets.left,
        systemInsets.top,
        systemInsets.right,
        bottomPadding
      )

      cachedInsetsJs = """
        (function() {
          var s = document.documentElement.style;
          s.setProperty('--safe-area-inset-top', '0px');
          s.setProperty('--safe-area-inset-bottom', '0px');
          s.setProperty('--safe-area-inset-left', '0px');
          s.setProperty('--safe-area-inset-right', '0px');
        })();
      """.trimIndent()

      // 立即尝试注入
      tryInjectInsets(view)

      WindowInsetsCompat.CONSUMED
    }

    // WebView 可能还没创建好，轮询几次确保注入成功
    scheduleInsetsInjection(contentView, 0)
  }

  override fun onResume() {
    super.onResume()
    startThemeSync()
  }

  override fun onPause() {
    stopThemeSync()
    super.onPause()
  }

  private fun startThemeSync() {
    if (themeSyncRunnable != null) return
    themeSyncRunnable = Runnable {
      val rootView = window.decorView.findViewById<View>(android.R.id.content)
      syncSystemBars(rootView)
      handler.postDelayed(themeSyncRunnable!!, 800L)
    }
    handler.post(themeSyncRunnable!!)
  }

  private fun stopThemeSync() {
    themeSyncRunnable?.let { handler.removeCallbacks(it) }
    themeSyncRunnable = null
  }

  private fun syncSystemBars(rootView: View) {
    val webView = cachedWebView ?: findWebView(rootView) ?: return
    val js = """
      (function() {
        var mode = document.documentElement.getAttribute('data-mode') || 'system';
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-100').trim();
        return JSON.stringify({ mode: mode, bg: bg });
      })();
    """.trimIndent()
    webView.evaluateJavascript(js) { result ->
      applySystemBarsFromJs(result)
    }
  }

  private fun applySystemBarsFromJs(result: String?) {
    if (result == null || result == "null") return
    val unescaped = result
      .trim('"')
      .replace("\\\\", "\\")
      .replace("\\\"", "\"")
    val json = try {
      org.json.JSONObject(unescaped)
    } catch (_: Exception) {
      return
    }
    val mode = json.optString("mode", "system")
    val bg = json.optString("bg", "")
    val color = parseCssColor(bg) ?: return
    val isLightBg = isColorLight(color)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = isLightBg && mode != "dark"
    controller.isAppearanceLightNavigationBars = isLightBg && mode != "dark"
    window.statusBarColor = color
    window.navigationBarColor = color
  }

  private inner class SystemBarBridge {
    @android.webkit.JavascriptInterface
    fun setSystemBars(mode: String, bg: String) {
      val color = parseCssColor(bg) ?: return
      val isLightBg = isColorLight(color)
      val controller = WindowInsetsControllerCompat(window, window.decorView)
      controller.isAppearanceLightStatusBars = isLightBg && mode != "dark"
      controller.isAppearanceLightNavigationBars = isLightBg && mode != "dark"
      window.statusBarColor = color
      window.navigationBarColor = color
    }

    @android.webkit.JavascriptInterface
    fun vibrate(ms: Int) {
      val duration = ms.coerceIn(1, 50).toLong()
      val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
        val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      if (!vibrator.hasVibrator()) return
      if (android.os.Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(duration)
      }
    }
  }

  private fun parseCssColor(value: String): Int? {
    val v = value.trim()
    if (v.isEmpty()) return null
    if (v.startsWith("rgb")) {
      val nums = v.substringAfter('(').substringBefore(')')
        .split(',')
        .map { it.trim() }
      if (nums.size < 3) return null
      val r = nums[0].toFloatOrNull() ?: return null
      val g = nums[1].toFloatOrNull() ?: return null
      val b = nums[2].toFloatOrNull() ?: return null
      return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }
    if (v.startsWith("hsl")) {
      val parts = v.substringAfter('(').substringBefore(')')
        .replace("%", "")
        .split(Regex("[ ,/]+"))
        .filter { it.isNotEmpty() }
      if (parts.size < 3) return null
      val h = parts[0].toFloatOrNull() ?: return null
      val s = (parts[1].toFloatOrNull() ?: return null) / 100f
      val l = (parts[2].toFloatOrNull() ?: return null) / 100f
      return hslToColor(h, s, l)
    }
    return try {
      Color.parseColor(v)
    } catch (_: Exception) {
      null
    }
  }

  private fun hslToColor(h: Float, s: Float, l: Float): Int {
    val c = (1 - kotlin.math.abs(2 * l - 1)) * s
    val hh = (h % 360) / 60f
    val x = c * (1 - kotlin.math.abs(hh % 2 - 1))
    val (r1, g1, b1) = when {
      hh < 1 -> Triple(c, x, 0f)
      hh < 2 -> Triple(x, c, 0f)
      hh < 3 -> Triple(0f, c, x)
      hh < 4 -> Triple(0f, x, c)
      hh < 5 -> Triple(x, 0f, c)
      else -> Triple(c, 0f, x)
    }
    val m = l - c / 2
    val r = ((r1 + m) * 255).toInt().coerceIn(0, 255)
    val g = ((g1 + m) * 255).toInt().coerceIn(0, 255)
    val b = ((b1 + m) * 255).toInt().coerceIn(0, 255)
    return Color.rgb(r, g, b)
  }

  private fun isColorLight(color: Int): Boolean {
    val r = Color.red(color) / 255f
    val g = Color.green(color) / 255f
    val b = Color.blue(color) / 255f
    val luminance = 0.299f * r + 0.587f * g + 0.114f * b
    return luminance > 0.6f
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
    cachedWebView = webView
    ensureJsBridge(webView)
    webView.evaluateJavascript(js, null)
    return true
  }

  private fun ensureJsBridge(webView: WebView) {
    try {
      webView.addJavascriptInterface(SystemBarBridge(), "__opencode_android")
    } catch (_: Exception) {
      // ignore - may be added already
    }
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
