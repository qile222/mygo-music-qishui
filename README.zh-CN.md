# 汽水音乐 for MyGo Music

[English](./README.md) | 中文

[MyGo Music](https://github.com/egoist/mygo-music) 的汽水音乐插件：扫码登录后，在 MyGo 里浏览、搜索、收藏并完整播放汽水音乐的歌单、榜单、专辑和艺人。单文件纯 JavaScript，没有构建步骤，不需要安装 Node.js、Electron 或任何原生 helper。

## 功能

- 首页：推荐歌单、热歌榜 / 新歌榜 / 欧美榜、登录后最近播放
- 发现、榜单、我喜欢、收藏专辑、最近播放
- 搜索：单曲、专辑、艺人、歌单
- 艺人页、专辑页、歌单页
- 歌词：KRC 逐字歌词与 LRC（播放页 Lyrics 面板），自动回退
- 红心：App 内点红心即收藏/取消，与汽水「我喜欢的音乐」同步
- 歌单：新建、重命名、删除、加歌/删歌、拖动排序；收藏/取消收藏别人的歌单
- 收藏专辑、关注歌手：在专辑页 / 艺人页操作，侧栏有「收藏专辑」页
- 评论：查看、点赞、发表（仅一级评论）
- 播放上报：开始播放时写入汽水的「最近播放」
- 完整播放：经官方 PC 播放接口取音频，插件内纯 JS 解密（CENC / AES-128-CTR）后交给播放器，不需要 ffmpeg
- 无损：支持官方无损 FLAC-in-MP4（MyGo 设置里选 Lossless）
- 缓存：最近 8 首解密后的整曲，重复播放与自动预取基本秒开

## 平台支持

**仅支持 macOS。** Windows / Linux 暂不支持。

所有功能都要求 macOS；完整播放与写操作还需要本机安装官方「汽水音乐 / Soda Music」macOS 客户端。

## 安装

要求：MyGo Music ≥ 0.1.22，且仅支持 macOS（完整播放与写操作还需本机安装官方「汽水音乐」macOS 客户端）。Windows / Linux 暂不支持。

1. 打开 MyGo Music → 设置（Settings）→ 插件（Plugins）→ `+`；
2. 选「从 GitHub」，填 `qile222/mygo-music-qishui`；
3. 安装后点插件菜单里的登录，用汽水音乐 App 扫码；
4. 在 MyGo 的播放设置里选音质（默认 High）。

也可以按下面的深链直接安装：

```
mygo-music://install-plugin?repo=qile222/mygo-music-qishui
```

或下载本仓库源码后，把整个文件夹放进 MyGo 的插件目录（Settings → Plugins → `+` → Show Plugins Folder），重启应用。

插件也会出现在 [MyGo 插件市场](https://mygo-music.egoist.dev/plugins)：GitHub 收录 `mygo-music-plugin` 话题后，在市场里搜索 `qishui` 即可。

## 为什么需要本机的官方客户端

汽水服务端对播放接口校验官方客户端签名。插件不内置任何签名器，而是在你本机已安装官方「汽水音乐」macOS 客户端时，借用它自带的 Electron 运行时调用官方签名模块（只读调用，不修改、不启动客户端界面）。没有安装官方客户端时，插件仍能浏览、搜索，但完整播放会提示不可用或退回试听。

- 插件启动的外部程序只有：`/usr/bin/base64`（系统自带，把解密后的音频写入插件数据目录）、`/usr/bin/env`（用于运行上述官方签名模块）。两者都只在 macOS 上使用。
- 首次使用需要在 MyGo 设置里允许插件启动程序（Allow Programs）。

## 音质档位

MyGo 的播放设置只暴露三档，对应汽水官方档位：

| MyGo | 汽水官方档位 | 典型码率 / 体积 |
| --- | --- | --- |
| Standard | medium（标准 AAC） | ~64 kbps，约 1–2 MB/首 |
| High（默认） | higher（高品 AAC） | ~128 kbps，约 3–5 MB/首 |
| Lossless | lossless（无损 FLAC） | ~0.8–1.6 Mbps，约 20–30 MB/首 |

没有所选档位时自动降级（lossless → hi_res → highest → higher → medium，其它档位同理）。官方的「空间音频」「极高」不单独暴露。

## 权限与隐私

`plugin.json` 声明的权限：

- 网络：`api.qishui.com`、`*.qishui.com`、`beta-luna.douyin.com`、`*.douyin.com`、`*.douyinpic.com`、`*.douyinvod.com`、`*.douyincdn.com`
- 程序（仅 macOS）：`/usr/bin/base64`、`/usr/bin/env`

登录 Cookie 只保存在本机 MyGo 的插件私有存储里（host.storage），不会上传到除汽水音乐接口以外的任何地方；插件日志不打印 Cookie、设备号、签名头或带签名的音频地址。

## 已知限制

- 只有登录账号本来就能播放的歌曲才会完整播放；没有权益的曲目按试听处理，插件不绕过 VIP / 付费限制。
- 评论只能发表一级评论：服务端与 MyGo 宿主都没有「回复 / 楼中楼」的接口或界面。
- 收藏/关注后的列表有 1–3 秒的最终一致性延迟。
- 汽水接口不是公开 API，可能随客户端版本变化；插件按「接口返回什么就展示什么」做降级，不保证长期可用。
- 当前版本只支持 macOS；Windows / Linux 暂不支持。

## 免责声明

本插件与汽水音乐、抖音、MyGo Music 官方均无关联，仅供个人学习与自用。请使用你自己的账号，并遵守汽水音乐的服务条款；请勿用于批量抓取、二次分发或其他侵犯版权与平台权益的行为。

## 许可证

[MIT](./LICENSE)

感谢 [MyGo Music](https://github.com/egoist/mygo-music) 提供插件运行时与文档。
