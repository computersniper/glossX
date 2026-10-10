# UI 修复前端日志

基线：2f93b04。独占右侧面板/浏览器/插件布局相关前端；不修改终端、trace、BottomPanel、StatusBar。

1. 插件窄栏问题来自标题与三个操作按钮挤在同一flex行；操作区独立wrap，标题保持横排。窄栏卡片改为图标/正文两列，按钮放到正文下方并横向wrap，版本标签不挤压中文标题。
2. 浏览器改为右侧AiPane第四个tab；store持久browserSessionId，openBrowserTab仅打开右侧，不改中心编辑器论文。旧center浏览器tab恢复时迁到右侧；BottomTab加terminal供主agent接线。
3. 打开浏览器入口创建实际初始about:blank页；空白页面展示网址引导。启动失败同时显示持久浏览器错误与toast；重试调用实际初始化。真实验证待执行。
