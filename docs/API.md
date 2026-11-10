# 汽水音乐 API 接口矩阵（实测）

> 本文档由接口测绘任务产出：所有请求均在 macOS + 本机已登录 Cookie 下**实测**，响应样本见 **fixtures/**。
> 面向插件实现者：每个能力给出「请求 → 解析 → 坑」三段，可直接照抄实现。
> 凭据与签名 URL 规则见 §0.2；文档与 fixtures 中**不含** Cookie、账号昵称/uid、完整签名 URL。

## 目录

- [0. 通用约定](#0-通用约定)
- [1. 首页与榜单](#1-首页与榜单)
- [2. 搜索](#2-搜索)
- [3. 播放（最重要）](#3-播放最重要)
- [4. 歌单](#4-歌单)
- [5. 我喜欢](#5-我喜欢)
- [6. 播放历史](#6-播放历史)
- [7. 专辑](#7-专辑)
- [8. 艺人](#8-艺人)
- [9. 电台](#9-电台)
- [10. 评论](#10-评论)
- [11. 歌词](#11-歌词)
- [12. 收藏专辑](#12-收藏专辑)
- [13. 首页次屏 / 个性化流 / 场景模式](#13-首页次屏--个性化流--场景模式)
- [14. 错误特征与容错](#14-错误特征与容错)
- [15. 分页约定](#15-分页约定)
- [16. 缓存建议](#16-缓存建议)
- [17. 字段规范化](#17-字段规范化)
- [18. 风险与未解决问题](#18-风险与未解决问题)
- [19. 探针工具与夹具](#19-探针工具与夹具)
- [附录 A：端点总表](#附录-a端点总表)
- [附录 B：实测样本 ID](#附录-b实测样本-id)

### 置信度图例

| 标记 | 含义 |
| --- | --- |
| ✅ | 多次实测、行为稳定，可直接照抄 |
| ⚠️ | 实测通过，但有边界/不确定性（已在正文注明） |
| ❓ | 未实测（参考实现或推断），实现时应兜底 |

### MVP 最短路径（建议先实现这 6 条）

1. 首页/榜单：<code>POST {APP}/luna/discover</code>（一次请求同时拿到歌单推荐和 3 个榜单）。
2. 搜索：<code>GET {PC}/luna/pc/search/{track,album,artist,playlist}</code>。
3. 播放：<code>GET {APP}/luna/h5/seo_track</code> → <code>track_player.video_model</code> 里的明文 M4A URL。
4. 我喜欢：<code>GET {PC}/luna/pc/me/playlist</code>(cookie+aid) 找 <code>type=1</code> → <code>GET {PC}/luna/pc/playlist/detail</code>(cookie+aid) 取曲目。
5. 歌单详情：<code>GET {PC}/luna/pc/playlist/detail</code>，**不传 count 一次拿全**。
6. 历史：<code>GET {PC}/luna/pc/me/recently-played-media</code>(cookie+aid)，播放仍走 seo_track。

---

## 0. 通用约定

### 0.1 Host / UA / 公共参数（✅）

| 名称 | 值 | 用途 |
| --- | --- | --- |
| APP host | <code>https://beta-luna.douyin.com</code> | 路径 <code>/luna/*</code>，App 接口 |
| PC host | <code>https://api.qishui.com</code> | 路径 <code>/luna/pc/*</code>，PC 接口 |
| Web 播放 | <code>https://beta-luna.douyin.com/luna/h5/seo_track</code> | 用普通 Chrome UA |
| App UA | <code>Luna/19.1.0 Android</code> | APP host 请求头 |
| PC UA | <code>LunaPC/3.0.0(290101097)</code> | PC host 请求头 |
| aid | <code>386088</code> | 汽水音乐 app id；**任何带 Cookie 的 PC 私有接口必须带** |
| App 公共 query | <code>aid=386088&device_platform=android&version_code=30020100&iid=&lt;iid&gt;</code> | 实测免签名；iid 可省略或用任意 15 位数字（插件运行时随机生成，不含账号信息） |

- 所有 POST 用 JSON body：<code>Content-Type: application/json; charset=utf-8</code>。
- GET 参数用 UTF-8 URL 编码（中文关键词直接 encodeURIComponent）。
- 读接口普遍**免签名**；带 Cookie 打 PC 私有接口时只需补 <code>aid=386088</code>（见 §4 歌单矩阵）。
- 参考实现里出现的 <code>X-Helios</code> / <code>X-Medusa</code> 签名**仅写操作和个别端点需要**；本文档列出的读接口实测均不需要。

### 0.2 Cookie 来源与红线（✅）

- Cookie 由宿主提供（运行时契约见 docs/RUNTIME.md），形如 <code>k=v; k2=v2</code>。插件只读使用。
- **绝对禁止**把 Cookie、sessionid、账号昵称/uid、完整签名音频 URL 写进仓库、日志、fixtures 或消息。
- 实测 Cookie 名（仅供排障时确认宿主注入是否成功，不要打印值）：<code>passport_csrf_token</code>、<code>uid_tt_ss</code>、<code>sessionid_ss</code>、<code>session_tlb_tag</code>、<code>ssid_ucp_v1</code>。
- 需要 Cookie 的能力：我喜欢、历史、收藏专辑、私密歌单、is_collected 标记。其余能力匿名可用。
- 若宿主未注入 Cookie：仅匿名能力可用（首页/榜单/搜索/专辑/艺人/评论/歌词/播放），私有能力应显示「登录后可用」。

### 0.3 响应信封与判定（✅）

成功（可能没有 status_code，或 status_code=0）：

    { "status_info": { "log_id": "<omit>", "now": 1794212118, "now_ts_ms": 1794212118741 }, "...": "业务字段" }

失败（HTTP 仍是 200）：

    { "status_code": 1000006, "status_info": { "status_msg": "ERR_REQUEST_FORBIDDEN", "now": 1794212454, "now_ts_ms": 1794212454735 } }

成功判定（JS）：

    function ok(j) { return j && (j.status_code === undefined || j.status_code === 0); }

- status_info.now 是 unix 秒，now_ts_ms 是毫秒；log_id 只用于排障，**不要持久化**。
- 未知路由返回**真 HTTP 404**，body 纯文本 404 page not found（Content-Type: text/plain）。
- 限流：连续 8 次 seo_track、连续 5 次 discover 均全部 200，未触发限流；实现仍建议并发 ≤2、超时 5s（见 §16）。

### 0.4 所有请求都要带的基础 Header

    // App / PC 读接口：UA 即可，实测无需 Referer / Origin / 额外签名头
    { "User-Agent": APP_UA }   // 或 PC_UA
    { "Accept": "application/json, text/plain, */*" }
    // POST 再加
    { "Content-Type": "application/json; charset=utf-8" }

---

## 1. 首页与榜单

### 1.1 主首页（一次拿到歌单推荐 + 3 个榜单）✅

    POST https://beta-luna.douyin.com/luna/discover?aid=386088&device_platform=android&version_code=30020100&iid=<iid>
    User-Agent: Luna/19.1.0 Android
    Content-Type: application/json; charset=utf-8

    {}

- 匿名可用，不需要 Cookie。实测 0.67–1.0 s，响应 **1.5–1.6 MB**（较大，务必做内存/渲染裁剪）。
- 顶层：status_info、blocks[]、background_color、style。
- 每次请求**歌单推荐块会轮换**（个性化/随机），榜单相对稳定。

结构（fixtures/home_discover.json）：

    blocks[0]  type=discover_feed_playlist  title="歌单推荐"
      block_style {column_size:5,row_size:2,link:"luna://luna.com/playlist-square"}
      inner_block[10] type=discover_playlist
        inner_block_id = 歌单 id
        resources[0] {resource_id, type:"playlist", fallback_type, entity.playlist{...}}

    blocks[1]  type=discover_top_song_list   （无 title）
      block_style {column_size:3,row_size:1}
      inner_block[3] type=discover_track_top_list  ← 榜单
        title = 热歌榜 | 新歌榜 | 欧美榜
        desc  =「汽水音乐内每周热度最高的50首歌，每周四更新」等
        inner_block_id = 榜单 id
        resources[50] {resource_id, type:"ranked_track", entity.ranked_track{rank{rank_delta,rank_type,track_id}, track{完整 track}}}

实测三个榜单：热歌榜 7036274230471712007（50 条）、新歌榜 7060812597884869927（实测 45 条）、欧美榜 7061475546400005410（50 条）。共约 145 首，其中 87 首 only_vip_playable。

解析要点：

    // 歌单推荐：每个 inner_block 的第一条 resource
    const recs = blocks.find(b => b.type === 'discover_feed_playlist')
      ?.inner_block.flatMap(ib => ib.resources?.slice(0, 1) || []) || [];
    // 榜单
    const charts = blocks.find(b => b.type === 'discover_top_song_list')
      ?.inner_block.map(ib => ({
        id: ib.inner_block_id,
        title: ib.title,
        desc: ib.desc,
        tracks: (ib.resources || []).map(r => r.entity?.ranked_track?.track).filter(Boolean),
      })) || [];

- **没有独立的榜单接口**：榜单数据从首页 blocks 取即可（如需刷新，重新请求 discover）。
- 榜单曲目是完整 track 实体（同 §3/§7 字段），可直接渲染、播放（播放仍走 seo_track）。
- 注意 resource_id 与 entity.playlist.id / entity.ranked_track.track.id 相同；以 entity 为准。
- 榜单可能不满 50 条（新歌榜 45 条），UI 不要写死 50。

### 1.2 轻量歌单流（可选，适合首页次屏）✅

    POST https://api.qishui.com/luna/pc/discover/mix
    User-Agent: LunaPC/3.0.0(290101097)
    Content-Type: application/json; charset=utf-8

    {}

- 匿名可用，195–250 ms，约 15 KB。顶层：status_info、has_more:true、inner_block[10]。
- 每个 inner：{type:"discover_playlist", title, inner_block_id, resources[0].entity.playlist}，无 next_cursor。
- 样本：fixtures/home_discover_mix.json。

### 1.3 场景模式入口（可选）⚠️

    POST https://api.qishui.com/luna/feed/mode
    {}

- 匿名可用，约 18 KB。返回 feed_mode_bar.feed_mode[]：
  - {type:"preference_mode", title:"推荐", mode:"default"}
  - {type:"scene_mode", title:"Chill 放松", scene_mode_id:3, sub_queue_type:"scene_mode_chill", url_info, cutover_toast}
  - 实测还有「快乐时光」(id=5, scene_mode_happy)、「专注模式」等。
- ⚠️ 点击场景模式后的内容流接口**未实测**，暂不建议做入口；或仅作为静态展示。

---

## 2. 搜索

### 2.1 四个独立搜索端点 ✅

搜索**没有可用的混合端点**（/luna/pc/search/mixed 实测 1000004，见 §18），按 tab 分别请求：

    GET https://api.qishui.com/luna/pc/search/track?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&cursor=0
    GET https://api.qishui.com/luna/pc/search/album?q=...&cursor=0
    GET https://api.qishui.com/luna/pc/search/artist?q=...&cursor=0
    GET https://api.qishui.com/luna/pc/search/playlist?q=...&cursor=0
    User-Agent: LunaPC/3.0.0(290101097)

| 参数 | 说明 |
| --- | --- |
| q | 关键词（必填）。缺省或空串 → 200 但只有 status_info+extra，无 result_groups |
| cursor | 偏移量字符串，首页传 0 或 空串；下一页用响应里的 next_cursor |
| count | **被忽略**：传 5 仍返回 20 条。页大小固定 20 |
| aid | 可选；匿名可搜，不需要 Cookie |

响应结构（fixtures/search_track.json 等）：

    {
      "status_info": { "now": 1794212455, "now_ts_ms": 1794212455184 },
      "result_groups": [{
        "id": "tracks",
        "next_cursor": "20",
        "has_more": true,
        "data": [
          { "meta": { "item_type": "track", "quick_play_info": { "...": "artist 结果才有" } },
            "entity": { "track_wrapper": { "track": { "...": "完整 track" }, "limited_free_info": null } } },
          "…（其余条目省略，结构相同）"
        ],
        "display_view_all": false, "display_title": "", "description": "", "bottom_desc": "", "display_type": ""
      }],
      "extra": { "log_extra": "{\"query_intention_type\":\"music_related\"}" }
    }

各 tab 的 result_groups[0].id 与 entity 键：

| 端点 | group id | entity | 说明 |
| --- | --- | --- | --- |
| search/track | tracks | {track_wrapper:{track, limited_free_info}} | 完整 track，可直接播放 |
| search/album | albums | {album} | 精简实体：id/name/artists/company/count_tracks/url_cover/release_date/intro |
| search/artist | artists | {artist} | 精简：id/name/count_albums/count_tracks/stats/state/url_avatar/simple_display_name/full_display_name；meta.quick_play_info 含 deeplink |
| search/playlist | playlists | {playlist} | 精简：id/title/url_cover/count_tracks/stats/owner/type/from_feed/resource_cnt |

- 耗时约 0.9–1.0 s/次，响应 115–128 KB；输入防抖 300–500 ms + 结果缓存 5 min。
- 翻页：has_more && next_cursor 时把 cursor 设为 next_cursor 再请求；无需 search_id。
- 空关键词不要请求（省流量）；result_groups 可能不存在，取数据前判空。

### 2.2 搜索联想 ✅

    GET https://api.qishui.com/luna/pc/sug?q=%E8%96%9B%E4%B9%8B

- 238 ms，约 1.8 KB。响应 sugs[{suggestion, content_type:"artist"|"playlist", entity:{artist{id}} 或 {playlist{id,type,from_feed}}, group_id}]。
- 样本：fixtures/search_sug.json。适合输入框下拉；也可以不做。

---

## 3. 播放（最重要）

### 3.1 结论（先看这个）

- **唯一可播放的明文路径**：GET https://beta-luna.douyin.com/luna/h5/seo_track?track_id=...&device_platform=web。
- 它返回的 track_player.video_model（**JSON 字符串**）里有 video_list[].main_url：明文 M4A/AAC，支持 Range(206) 与 HEAD(200)，无 DRM。
- POST /luna/media-player、POST /luna/pc/track_v2 返回的音频**全部加密**（encrypt_info.encryption_method="cenc-aes-ctr"，gear_des_key 含 audio_encrypt），ffprobe 能读时长但解码报错——**不能作为播放源**。
- 播放 URL 匿名可得，**不需要 Cookie**；带 Cookie 只影响 state.is_collected（是否已喜欢）。
- 曲目覆盖不是 100%：实测 20 首有 17 首能拿到 track_player；拿不到的按 §3.4 降级。

### 3.2 请求与解析 ✅

    GET https://beta-luna.douyin.com/luna/h5/seo_track?track_id=6778775242320906241&device_platform=web
    User-Agent: Mozilla/5.0 ... Chrome/126 ...
    Cookie: <可选，宿主提供>

- 200，180–242 KB，0.47–0.76 s。**一次请求同时拿到播放 URL + 歌词 + 相关曲目**（评论需另请求，见 §10）。
- 顶层：status_info、lyric、seo_track、track_player（可能缺失）、comments、album_tracks、artist_tracks、chart_tracks。
- 解析步骤：

    const j = await getJson(SEO_URL + '?track_id=' + id + '&device_platform=web');
    const tp = j.track_player;
    if (!tp || !tp.video_model) return unavailable();      // 无播放源
    const vm = JSON.parse(tp.video_model);                 // 注意：是字符串
    const audios = (vm.video_list || []).map(v => ({
      quality: v.video_meta.quality,                       // highest | higher | medium
      bitrate: v.video_meta.bitrate,                       // ~257699 / ~129xxx / ~65xxx
      size: v.video_meta.size,
      url: v.main_url,
      backup: v.backup_url,
    }));

字段（fixtures/play_seo_track.json）：

    track_player = {expire_at, media_id(vid), url_player_info(null), video_model(JSON string), video_model_type}
      video_model = {status:"10", message:"success", version:"3", video_id, enable_ssl:"True",
                     video_duration:"60.001" | "192.84",    // 秒，字符串
                     media_type:"audio", url_expire:"1794302011",  // epoch 秒，约 now+24h
                     video_list:[{main_url, backup_url, gear_des_key,
                                  video_meta:{quality,vtype:"m4a",bitrate,codec_type:"aac",size,
                                              file_id,file_hash,real_bitrate,audio_sample_rate:"44100"}}],
                     volume:{loudness,peak,volume_info_json}}

- main_url 形如 https://v5-luna.douyinvod.com/<hash>/<exp>/video/tos/...，**带签名**（不要落库/打日志）。
- 实测 CDN 支持 HEAD → 200、Range: bytes=0-1023 → 206，Content-Type video/mp4，可直接边下边播。
- 音频为 m4a 容器 + AAC，44.1 kHz；三档码率约 65.5 / 129.5 / 257.5 kbps；**部分曲只有 1–2 档**（如仅 higher），选档要兜底。

### 3.3 全曲 vs 试听（务必区分）✅

- 拿全曲：video_duration（秒）≈ seo_track.track.duration / 1000（如 192.84 vs 192864 ms）。
- 试听：video_duration 明显小于曲长（实测 30.001 / 49.645 / 50.434 / 60.001 秒，各曲不同）。
  - VIP-only（label_info.only_vip_playable:true）曲目实测 9/9 都能拿到 track_player，但都是试听片段，**不是整曲**。
  - 判断：video_duration * 1000 + 1500 < track.duration → 试听。
- 试听片段的实际内容起点**无法从响应确认**（preview.start / audition_info.start_time_ms 给了推荐起点，如 60000 ms，但 CDN 文件本身只有 60 s，无法验证是否从该位置开始）。实现建议：**按 0:00 播放**，UI 标注「试听」，进度条用 video_duration；不要 seek 超出可播时长。
- 注意：limited_free_info 为 null 不代表能播全曲；一切以 video_duration 对比为准。
- 合规：只播接口明确返回的音频；试听就显示试听，**不要尝试解密 DRM 流**（AGENTS.md 已约定）。

### 3.4 无播放源的降级 ✅

- track_player 缺失或 video_list 为空 → 该曲当前不可播。
- 实测 3/20 首无 player（7701264271522908212、7658841584689285160、7626684373319829523）；重试 4 次、换 device_platform（web/android/pc/空）均无 → **不是抖动，是曲目/版权/地区限制**。
- 兜底顺序：
  1. 重试 1 次（同一请求，避免瞬时失败）；
  2. 仍无 → 标记「不可播放」并置灰；可提示换一首；
  3. 不要用 /luna/media-player 的加密 URL 兜底（解码失败）。
- 有些不可播曲目连元数据端点也异常：7626684373319829523 的 track_v2 只回 145 B 且 track 缺失、name:null → 渲染前判空。

### 3.5 播放 URL 生命周期与刷新 ✅

- video_model.url_expire（epoch 秒）约 now + 24 h；track_player.expire_at 同量级。
- 建议：URL 缓存 **≤ 10 min**，在 url_expire - 5 min 前刷新；播放中断（403/410）时重新请求 seo_track。
- **不要把带签名的 URL 写进任何持久化数据**；只放内存。

### 3.6 不要用的端点（只作元数据/歌词）⚠️

| 端点 | 返回 | 为什么不能播 |
| --- | --- | --- |
| POST {APP}/luna/media-player（body: media_id=trackId, media_type:"track", queue_type:"", enable_refresh_api:false, enable_dash:true） | player_infos[0].video_model（加密 JSON）+ url_player_info（VOD GetPlayInfo 签名 URL） | 音频 encrypt_info={encrypt:true, encryption_method:"cenc-aes-ctr"}，gear_des_key="0:M4A\|1:audio_encrypt\|..."；ffprobe 解码报 channel element 3.7 is not allocated |
| POST {PC}/luna/pc/track_v2（body: {track_id}） | 同构响应，含加密 track_player | 同上；且带 Cookie 会 1000006（需签名） |
| GET {PC}/luna/pc/track_v2?track_id=&media_type=track&queue_type= | track + lyric（**无** track_player） | 适合匿名取歌词/元数据，不能播 |
| GET {PC}/luna/pc/track_v2 带 Cookie | 1000006 | 不要给 PC track_v2 带 Cookie |

补充：media-player 匿名/带 Cookie 都 200，166–307 ms，6.4 KB；带 Cookie 时可能给整曲时长（如 217.02 s），但音频仍加密。

---

## 4. 歌单

### 4.1 端点 ✅

    GET https://api.qishui.com/luna/pc/playlist/detail?playlist_id=7031081053599074335[&aid=386088][&cursor=0][&count=N]
    User-Agent: LunaPC/3.0.0(290101097)
    Cookie: <可选，见矩阵>

APP host 等价：POST {APP}/luna/playlist/detail body {playlist_id, cursor, count}，返回字段相同（实测一致）。

### 4.2 Cookie/aid 矩阵（**最容易踩的坑**）✅

| Cookie | aid | 公开歌单 | 私密歌单（如「我喜欢的音乐」） |
| --- | --- | --- | --- |
| 无 | 无 | ✅ 200 | ❌ 1000005 ERR_RESOURCE_NOT_FOUND |
| 无 | 有 | ✅ 200 | ❌ 1000005 |
| 有 | **无** | ❌ 1000006 ERR_REQUEST_FORBIDDEN | ❌ 1000006 |
| 有 | 有 | ✅ 200 | ✅ 200 |

实现建议：

    const params = { playlist_id: id, cursor: '' };
    if (cookie) params.aid = '386088';   // 带 Cookie 必须带 aid；不带 Cookie 时加不加都行

### 4.3 响应与字段 ✅

    {
      "status_info": {...},
      "playlist": {
        "id": "<liked-playlist-id>",
        "title": "我喜欢的音乐",
        "url_cover": {"uri": "...", "urls": ["https://p3-luna.douyinpic.com/img/"], "template_prefix": "tplv-b829550vbb"},
        "count_tracks": 12,                    // 示例值；会抖动且与 resource_cnt 不一致，仅作展示参考
        "owner": {"id": "<uid>", "nickname": "<昵称>", "medium_avatar_url": {...}},
        "stats": {"count_collected": 0, "count_shared": 1, "count_visible": 13},
        "resource_cnt": {"track_cnt": 12, "mv_cnt": 0},
        "create_time": 1690000000, "update_time": 1794211800,   // unix 秒
        "review_status": "Accept",
        "is_private": true,
        "type": 1,                     // 1=我喜欢的音乐；4=抖音收藏的音乐；3=未知（参考实现）
        "from_feed": false,
        "cover_gradient_effect_color": [{"rgb": "a9758c"}, {"rgb": "121212"}],
        "all_sort_types": [...], "public_title": "<用户昵称>喜欢的音乐"
      },
      "media_resources": [
        {"id": "<track_id>", "type": "track", "entity": {"track_wrapper": {"track": {"...": "完整 track"}, "limited_free_info": null}}}
      ],
      "has_more": true,          // 仅传 count 时出现
      "next_cursor": "50"
    }

样本：fixtures/playlist_detail.json（已脱敏）。

- media_resources[] 实测只含 type:"track"；取 entity.track_wrapper.track。
- count_tracks / stats.count_visible / resource_cnt.track_cnt **三者可能不一致**（示例值：可能不一致，且多次请求会小幅抖动）。**以 media_resources.length 为准**。
- public_title 可能含账号昵称（如「<用户昵称>喜欢的音乐」），展示时可用 title 或做脱敏。

### 4.4 分页（关键坑）✅

- **不传 count**：返回全部**可播**曲目，has_more 不出现（next_cursor 可能是总偏移，忽略即可）。实测公开歌单（22 首）一次返回；示例账号的喜欢列表同样可一次返回。
- **传 count=N**：has_more:true、next_cursor 为偏移字符串；但 **cursor 按「原始资源槽位」计数，不是按返回曲目数**：
  - 公开歌单 stats.count_visible=25、25 个槽位，实际只返回 22 首可播 track；count=20 时只回 17 首，next_cursor="20"；再翻一页回 5 首（has_more 消失）。
  - 所以**每页可能少于 count**，且可能有槽位空洞。
- **推荐策略**：优先不传 count 一次拿全（多数歌单 < 100 首）；极大歌单才用 next_cursor 翻页，并以 track id 去重、以 media_resources.length 计数。
- cursor 起点 空串 或 0 均可。

### 4.5 歌单发现入口

- 首页/歌单流里的 playlist 实体（§1.1、§1.2）可直接点进详情。
- 用户自己的歌单列表见 §5.2（/luna/pc/me/playlist）。

---

## 5. 我喜欢

### 5.1 登录态 ✅

    GET https://api.qishui.com/luna/pc/me?aid=386088
    Cookie: <宿主注入>

- 200，4–5 KB。{status_code:0, status_info, my_info{id, nickname, douyin_id, larger_avatar_url, medium_avatar_url{uri, urls}, ...}, my_stats, me_tab_sidebar}。
- APP host 等价：GET {APP}/luna/me + APPQ + Cookie（同样可用，4.9 KB）。
- 错误：无 Cookie → 1000016「登录状态已失效，请重新登录」；带 Cookie 无 aid → 1000006。
- ⚠️ my_info 含账号昵称/uid 等隐私字段：**只用于界面展示，不写日志、不落库**。

### 5.2 我的歌单列表 → 找「我喜欢的音乐」✅

    GET https://api.qishui.com/luna/pc/me/playlist?aid=386088&cursor=&count=50
    Cookie: <宿主注入>

- 200，5.9 KB，{status_info, playlists[], total_num}。
- 实测 playlists[0] = 我喜欢的音乐：id=<liked-playlist-id>、is_private:true、type:1、count_tracks:<n>、resource_cnt:{track_cnt:<n>,mv_cnt:0}（ID/数量属于账号数据，文档与夹具中已替换为合成值）。
- playlists[1] = 抖音收藏的音乐：id=<douyin-playlist-id>、type:4、count_tracks:null。
- 找喜欢列表：playlists.find(p => p.type === 1)（不要按标题匹配，标题可能本地化/含昵称）。
- 取曲目：用 §4 的 playlist/detail（**必须带 Cookie + aid**），见 §4.2 矩阵。
- 样本：fixtures/me_playlist.json（owner 已脱敏）。

### 5.3 喜欢状态（is_collected）✅

- track 实体 state:{is_collected:true} = 已喜欢；未喜欢为 {}。
- 来源：我喜欢歌单曲目、seo_track（**带 Cookie** 请求时）。PC 搜索/专辑等带 Cookie 时是否回填未逐一验证 ⚠️。
- 插件 UI 可在播放/详情时用 seo_track(带 Cookie) 判断红心状态。

### 5.4 写操作（不支持）❌

- 收藏/取消收藏、创建/修改歌单、评论/点赞等写接口（/luna/pc/me/collection/*、/luna/me/playlist/media/*、/luna/pc/comments/create 等）均需 X-Helios/X-Medusa 签名，实测未通过。
- **本插件只读**：不实现写收藏/写评论；如果 UI 需要红心，仅展示状态（或本地标记，不要误导用户）。

---

## 6. 播放历史

    GET https://api.qishui.com/luna/pc/me/recently-played-media?aid=386088&cursor=&count=50
    Cookie: <宿主注入>
    User-Agent: LunaPC/3.0.0(290101097)

- 200；{status_info, media[], next_cursor, has_more, total_num}。
- media[i] = {id, type:"track", entity:{track: 完整 track 实体}}（注意：这里是 entity.track，不是 track_wrapper）。
- 实测：total_num 最大为 500（服务端历史上限，不是具体账号的数量）；count 支持 10/30/50/100/200；count=200 实际返回 198（个别条目被过滤）；next_cursor = 本页结束偏移（10→"10"，50→"50"，200→"200"），cursor 为偏移量。
- has_more 用于继续翻页；到 total_num 或 has_more=false 停止。
- 错误：缺 aid + 有 Cookie → 1000006；无 Cookie → 1000016。
- 历史**只有元数据，没有播放 URL**；播放仍用 §3 seo_track。
- 样本：fixtures/history.json。

---

## 7. 专辑

    GET https://api.qishui.com/luna/pc/albums/6778775240618018818
    User-Agent: LunaPC/3.0.0(290101097)

- 匿名可用（无需 Cookie/aid），200，约 66 KB。
- {status_info, album_info{...}, tracks[完整 track 实体]}。
- album_info 关键字段：id, name, artists[{id,name,url_avatar}], company, count_tracks, release_date(unix 秒), intro, stats{count_collected,count_shared,total_count_purchased,count_only_vip_playable,count_only_vip_without_artist_listen_benefit}, state{}, url_cover, url_player_bg{template:"background:width:height:30:90:0"}, cover_gradient_effect_color, cover_shadow_color, snack_bar_color。
- tracks 实测整张返回（count_tracks=10 → 10 条），**无分页字段**；大专辑是否截断未实测 ⚠️（如遇 tracks 为空/不足，可考虑走艺人 tracks 或搜索兜底）。
- 曲目含 label_info.only_vip_playable、preview、audition_info，可直接渲染 VIP 标记；播放走 §3。
- 样本：fixtures/album.json（2 首示例）。

---

## 8. 艺人

### 8.1 艺人详情 ✅

    GET https://api.qishui.com/luna/pc/artists/6807264292040083458

- 匿名可用，200，约 55 KB。{status_info, artist_info{...}}。
- 字段：id, name, count_albums, count_tracks, stats{count_collected}, state{blocked_by_me}, url_avatar, artist_profile{name, alias[], born{birth_date}, name_translation, career{occupations[]}, intro, nationality, full_display_name}, user{id,nickname,avatar,...}, simple_display_name, full_display_name, user_artist_type。
- 样本：fixtures/artist.json（intro 等长字段已裁剪）。

### 8.2 艺人热门曲目 ✅（分页注意）

    GET https://api.qishui.com/luna/pc/artists/6807264292040083458/tracks?cursor=0&count=20

- 200，约 61 KB，{status_info, tracks[完整 track], has_more, next_cursor}。
- **页大小固定 10 首**（count 传 10/20/50/100 都只回 10 条，实测）；cursor 是偏移字符串，next_cursor = cursor + 10。
- 翻页：cursor=next_cursor 直到 has_more=false；用 track id 去重。
- 返回的都是完整 track 实体，可直接播放（seo_track）。

### 8.3 艺人专辑 ✅（分页不稳，需兜底）

    GET https://api.qishui.com/luna/pc/artists/6807264292040083458/albums?cursor=0&count=20

- 200，约 115 KB，{status_info, albums[], has_more, next_cursor}。
- 实测每页条数**不固定**：cursor=0 回 21 条、next_cursor="50"；cursor=21 回 25 条、next=71；cursor=50 回 35 条、next=100；count=50 时回 56 条、next=100。
- next_cursor 约为 cursor + 50（并非返回条数累加）。实现：按 next_cursor 翻页直到 has_more=false，**按 album id 去重**，不要假设每页条数。
- 每个 album 是精简实体（id/name/artists/count_tracks/url_cover/release_date 等）。

---

## 9. 电台

### 9.1 电台列表 ✅

来自 PC 首页发现：

    POST https://api.qishui.com/luna/pc/discover
    Content-Type: application/json; charset=utf-8

    {"first_request":true,"pc_new_discover_request":true}

- 匿名，约 10.5 KB。返回 1 个 block：type="discover_playlist_mix"，title="为你推荐，每天来点新模式"，inner_block[12] 全部是电台。
- 每个 inner：{type:"discover_radio", title, inner_block_id, resources[0]}，资源：

    {"resource_id": "7408841207004184603", "type": "radio",
     "style": {"title": "热情布鲁斯", "desc": "热情奔放的布鲁斯节奏",
               "link": "luna://luna.com/play_source?queue_id=7408841207004184603&queue_type=radio&queue_name=...&sub_queue_type=...&flow_type=2",
               "type": 5,
               "cover_color": {"dominant_color": {"rgb": "374A15"}, "base_five_color": {"rgb": "465729"}},
               "cover_url_list": [{"uri": "...", "urls": ["https://p3-luna.douyinpic.com/img/"], "template_prefix": "tplv-b829550vbb"}],
               "passthrough": "{\"radio_inner_rec_type\":0}"}}

- 电台 id 从 resources[0].resource_id（或 style.link 的 queue_id）取；标题/描述/封面从 style 取。
- 样本：fixtures/home_pc_discover_mix.json（2 个电台示例）。

### 9.2 电台曲目 ⚠️

    POST https://api.qishui.com/luna/pc/feed/radio/tracks
    Content-Type: application/json; charset=utf-8

    {"radio_id":"7408841207004184603","count":6,"cursor":"","flow_type":2}

- 匿名可用（APP host POST {APP}/luna/feed/radio/tracks 也可以），200，35–38 KB。
- **必须带 flow_type**：style.type===6 是歌手电台（flow_type=1），style.type===5 是曲风/类型电台（flow_type=2）。不带 flow_type 时服务端按通用推荐流返回，会出现点 Jessie J 却播别人歌、点谭晶播无关内容的问题（2026-11-11 实测）。
- {status_info, has_more:true, items[{id,type:"track",entity:{track_wrapper:{track}}}]}；**无 next_cursor**。
- ⚠️ cursor 语义不稳定：连续请求可能返回相同/重叠曲目；偶发 items:[] 但 has_more:true。
- 实现建议：把 items 按 track id 去重追加；空 items 视为「本轮为空」→ 重试 1 次或结束本轮；用 has_more 决定是否继续「换一批」。不要依赖 cursor 去重。
- 播放仍走 §3 seo_track（电台只给元数据）。

---

## 10. 评论

### 10.1 读评论 ✅（推荐 APP host）

    GET https://beta-luna.douyin.com/luna/comments?group_id=6778775242320906241&group_type=0&cursor=&count=20&image_strategy=2&aid=386088&device_platform=android&version_code=30020100&iid=<iid>
    User-Agent: Luna/19.1.0 Android
    Cookie: <可选>

- APP host 匿名/带 Cookie 都可用（实测 200，约 70 KB）。**推荐用这个**：插件已有 Cookie 时也不用摘 Cookie。
- PC host 等价：GET https://api.qishui.com/luna/pc/comments 同参数 + PC UA，但**带 Cookie 会 1000006**（该端点 + Cookie 需签名）→ 要么不带 Cookie，要么别用 PC host。
- 参数：
  - group_id = track id；
  - group_type=0（**数字 0**，传字符串 "track" → 1000004 ERR_INVALID_PARAM）；
  - cursor 偏移字符串（首页 空串，下一页用响应 cursor）；
  - count（实测 20 可用）；
  - image_strategy=2。
- 响应：

    {"status_info": {...},
     "comments": [{
        "id": "...", "content": "含换行和[表情]的文本",
        "count_digged": 3, "time_created": 1762000000,
        "user": {"id": "<uid>", "nickname": "<昵称>", "medium_avatar_url": {"uri": "...", "urls": ["<签名头像URL>"]}},
        "count_reply": 0, "featured": false, "visibility": 1,
        "featured_tags": ["音乐推荐"],
        "user_artist_info": {"user_artist_type": 0, "user_brief": {...}},
        "service_id": ..., "ip_label": "<region>"
     }],
     "count": "<total>",        // 总评论数（字符串，且不同端点可能不同，见下）
     "cursor": "20",            // 下一页偏移
     "has_more": true,
     "prompts": ["写下你想说的..."]}

- 样本：fixtures/comments.json（用户已脱敏）。
- ⚠️ count 不一致：同一首歌 PC 匿名与 APP 带 Cookie 返回的总数可能不同。**总评论数只作展示参考**，不要用它判断是否还有下一页（用 has_more）。
- user.medium_avatar_url.urls[] 是签名 CDN 链接，会过期；不要持久化。
- 无 Cookie 也可读；评论排序由服务端决定（未见排序参数）。
- 回复内容/回复列表接口未实现 ❓（响应只有 count_reply）。

### 10.2 写评论（不支持）❌

- /luna/pc/comments/create、/luna/pc/comments/action 需签名，未实测通过。插件只读。

---

## 11. 歌词

### 11.1 来源 ✅

优先级从高到低：

1. **播放请求顺带拿**：seo_track 响应里的 lyric（与 §3 同一次请求，零额外成本，推荐）。
2. GET https://api.qishui.com/luna/pc/track_v2?track_id=<id>&media_type=track&queue_type= （匿名，**不要带 Cookie**）→ lyric + track（无播放 URL）。
3. POST {APP}/luna/pc/track_v2 匿名也可，但同样无明文播放 URL；一般不需要。

lyric 字段：

    {"id": "...", "lang": "ZH-HANS-CN", "type": "krc",
     "hide_request_lyrics": false,
     "content": "[18490,5210]<0,350,0>和<350,280,0>你<630,300,0>有<1000,370,0>关<3720,350,0>观<4070,300,0>后<4370,320,0>无<4840,370,0>感\n[25400,4000]<0,300,0>...",
     "lyric_contributor": {"filter_reason": 0}}

- 实测抽样 3 首全部 type:"krc"，0 行非 krc 格式；无元数据行；未见翻译行（部分曲可能含 translation_contributor，未抽样到 ⚠️）。
- 歌词缺失时 lyric 不存在或 content 为空 → 显示「暂无歌词」。

### 11.2 krc → LRC 转换 ✅

krc 每行结构：[行起始ms,行时长ms]<字起始ms,字时长ms,0>字<...>...

    // 返回 { lrc: "[mm:ss.xxx]文本\n...", lines: [{start_ms, duration_ms, text, words:[{text,start_ms,end_ms}]}] }
    function parseKrc(content) {
      const lines = [], lrc = [];
      for (const raw of String(content || '').split('\n')) {
        const m = /^\[(\d+),(\d+)\](.*)$/.exec(raw.trim());
        if (!m) continue;
        const start = +m[1], dur = +m[2];
        const words = [];
        let text = '';
        const re = /<(\d+),(\d+),(\d+)>([^<]*)/g;
        let w;
        while ((w = re.exec(m[3])) !== null) {
          words.push({ text: w[4], start_ms: start + (+w[1]), end_ms: start + (+w[1]) + (+w[2]) });
          text += w[4];
        }
        if (!text) { // 容错：没有字级标签时去掉标签直接取文本
          text = m[3].replace(/<\d+,\d+,\d+>/g, '');
        }
        lines.push({ start_ms: start, duration_ms: dur, text, words });
        const mm = String(Math.floor(start / 60000)).padStart(2, '0');
        const ss = String(Math.floor((start % 60000) / 1000)).padStart(2, '0');
        const ms = String(start % 1000).padStart(3, '0');
        lrc.push('[' + mm + ':' + ss + '.' + ms + ']' + text);
      }
      return { lrc: lrc.join('\n'), lines };
    }

- 注意：字级时间 <wordStart,dur,0> 是**行内相对偏移**（相对行起始），要加上行 start 才是绝对时间。
- 推荐 UI 用 lines 做逐行高亮（start_ms 比较播放进度），可选字级卡拉 OK。
- 行文本可能含空格/英文；不要丢字。

---

## 12. 收藏专辑

### 12.1 端点 ⚠️（空形状实测，非空形状未实测）

    GET https://api.qishui.com/luna/pc/me/collection/mixed?aid=386088&cursor=&count=20&item_types=album&item_types=playlist
    Cookie: <宿主注入>

- 示例账号收藏为空时 → 200，仅 106 B：{status_info}（没有 mixed_collections/total_num/has_more）。见 fixtures/collection_empty.json 与 fixtures/errors.json。
- 缺少参数/无 Cookie 的失败形状：缺 aid + Cookie → 1000006；/luna/pc/me/collection/album、/luna/pc/me/collection/playlist 均 **404**；/luna/pc/me/collection/artist?aid=386088 → 200 126 B {status_info,next_cursor:"0_0"}（空）。
- 非空响应结构（参考实现事实，**未实测** ❓）：mixed_collections[]，每项 item{item_type:"album", album{...}} 或 {item_type:"playlist", playlist{...}}，另有 has_more、next_cursor、total_num。
- 实现建议：请求后判 Array.isArray(j.mixed_collections) && j.mixed_collections.length；否则显示空态。单曲收藏（/luna/pc/me/collection/media）可作后续扩展，需签名，当前不做。

---

## 13. 首页次屏 / 个性化流 / 场景模式

> 这些是「可选增强」，MVP 可跳过。均已实测但稳定性一般。

### 13.1 个性化歌曲流 ⚠️

    POST https://api.qishui.com/luna/pc/feed/song-tab
    Content-Type: application/json; charset=utf-8

    {"cursor":"","count":6}

- 匿名，565 ms，36 KB：{status_info, has_more:true, items[{id,type:"track",entity:{track_wrapper:{track}}}], predict_info:{}}。
- **无 next_cursor**；cursor 传已获取条数（偏移）；实测 page 0/6/10 之间各重叠 2 首 → 用 track id 去重。
- APP host POST {APP}/luna/feed/song-tab → 1000006「当前设备无法访问」，**不可用**。
- 样本：fixtures/feed_song_tab.json。

### 13.2 场景模式

见 §1.3（仅入口数据，内容流未实测）。

---

## 14. 错误特征与容错

### 14.1 错误码表（实测样本：fixtures/errors.json）

| status_code | status_msg | 典型场景 | 处理 |
| --- | --- | --- | --- |
| 无/0 | — | 成功 | — |
| 1000004 | ERR_INVALID_PARAM | 参数缺失/类型错（如 comments group_type:"track"、缺 group_id、search/mixed 参数不对） | 修参数；属实现 bug |
| 1000005 | ERR_RESOURCE_NOT_FOUND | 资源不存在/无权限（如匿名看私密歌单、track id 不存在、某些曲目连 media-player 都 404） | 显示「不可用/不存在」；不要重试 |
| 1000006 | ERR_REQUEST_FORBIDDEN | 带 Cookie 缺 aid、PC 读接口带 Cookie（comments/track_v2）、PC 写接口、APP song-tab | 补 aid；或去掉 Cookie；或换 APP host 端点 |
| 1000016 | 登录状态已失效，请重新登录 | 私有接口无 Cookie / Cookie 过期 | 提示重新登录；匿名功能继续可用 |
| HTTP 404 | 纯文本 404 Page not found | 路由不存在 | 路径写错，检查 host/path |

- 同一 HTTP 200 下两种信封：成功可能无 status_code，失败必有 status_code 和 status_msg。
- status_msg 可能是英文码，也可能是中文提示（APP song-tab 实测中文），**不要按字符串判断分支，按 status_code**。
- log_id 仅排障用；如需上报错误，可带 status_code + 端点 + 时间，不要带 log_id/Cookie。

### 14.2 网络层容错建议

- 超时 5 s；失败重试 1 次（指数退避 300–800 ms）；非 2xx/非 JSON 视为网络错误。
- 并发 ≤ 2（实测未触发限流，但保守）；首页 discover 1.5 MB，避免并发拉多次。
- 播放失败（403/410）→ 重新 seo_track 取新 URL，不重试旧 URL。

---

## 15. 分页约定

| 端点 | 页大小 | cursor 语义 | 结束条件 | 备注 |
| --- | --- | --- | --- | --- |
| search/{track,album,artist,playlist} | 固定 20（count 无效） | 偏移字符串 | has_more=false 或 next_cursor 空 | next_cursor 可直接继续 |
| playlist/detail | count 参数控制（不传=全部） | **原始资源槽位偏移**（非返回条数） | 不传 count 无 has_more；传 count 到末页 has_more 消失 | 优先不传 count |
| artists/{id}/tracks | 固定 10 | 偏移字符串 | has_more=false | next = cursor+10 |
| artists/{id}/albums | 不固定（21–56） | 偏移字符串 | has_more=false | next≈cursor+50，需去重 |
| me/playlist | count 参数（实测 50） | 偏移 | total_num | 账号歌单少，通常一次够 |
| me/recently-played-media | count（支持 10/30/50/100/200） | 偏移 | has_more=false 或到 total_num | 上限 500；count=200 实际 198 |
| comments | count（实测 20） | 偏移 | has_more=false | cursor 字段即下一页偏移 |
| feed/song-tab | count | 已获取条数（偏移） | has_more:true 恒真 | 有重复，必须去重 |
| me/collection/mixed | count | 偏移 | has_more=false | 非空形状未实测 |

通用：

- cursor 一律当**字符串**处理（"20"），不要 parseInt 后丢前导；传回时原样。
- 每页结果按业务 id 去重（推荐流/电台/艺人专辑都会重复）。
- has_more 可能缺失（歌单不带 count 时）→ 视为 false。

---

## 16. 缓存建议

实测响应头**没有** Cache-Control/ETag（server: Tengine、x-tt-trace-tag: cdn-cache=miss;type=dyn），全部动态生成，必须插件侧缓存。

| 数据 | 建议 TTL | 说明 |
| --- | --- | --- |
| 首页 discover | 5–10 min | 歌单推荐轮换；榜单 30–60 min 可单独缓存 |
| 榜单（从 discover 提取） | 30–60 min | 相对稳定，每周四更新 |
| 搜索 results | 5 min | 按 端点+q 做 key；翻页结果可缓存 5 min |
| 搜索联想 sug | 10 min | 按前缀 |
| track / album / artist 元数据 | 1–24 h | 按 id |
| seo_track 响应（含 URL） | URL 10 min；响应体可 1 h | 播放 URL 在 url_expire 前 5 min 刷新 |
| 歌单详情 | 5 min | 按 playlist_id |
| 我喜欢 / 历史 | 30–60 s | 用户态数据，易变 |
| 评论 | 5 min | 按 track_id + 页 |
| 歌词 | 24 h | 按 track_id（随 seo_track 缓存即可） |
| 封面图/头像 | 按 HTTP 缓存即可 | 头像 URL 带签名会过期，不要长期存 |

- 所有缓存只放内存/宿主临时目录，**不要持久化签名 URL、Cookie、账号信息**。
- 首页 1.5 MB，建议只解析需要的块并及时释放原始 JSON（避免多次深拷贝）。

---

## 17. 字段规范化

### 17.1 封面 URL 构造 ✅

封面统一是 {uri, urls[], template_prefix} 结构：

    // 实测可用：urls[i] + uri + '~' + template_prefix + '-crop-center:W:H.jpg'
    function coverUrl(cover, w = 200, h = 200) {
      if (!cover) return null;
      if (Array.isArray(cover.urls) && cover.urls.length && cover.uri) {
        const base = cover.urls[0];
        if (/^https?:\/\//.test(base) && !base.endsWith('/img/')) return base; // 已是完整 URL
        return base + cover.uri + '~' + (cover.template_prefix || '') + '-crop-center:' + w + ':' + h + '.jpg';
      }
      return null;
    }
    // 例：https://p3-luna.douyinpic.com/img/<uri>~tplv-b829550vbb-crop-center:200:200.jpg → 200 image/jpeg
    // 注意：不带 '~template' 直接拼 uri 会 400；template_prefix 缺失时降级用 uri 原图。

- 头像（user.medium_avatar_url）的 urls[] **已是完整签名 URL**，直接用 urls[0]，不要再用 uri 拼接；会过期，不要持久化。
- 播放背景 url_player_bg.template 是 "background:width:height:30:90:0"，把 width/height 替换为实际尺寸后配合封面使用；缺省可不实现。

### 17.2 时间 / 时长 ✅

| 字段 | 单位 | 说明 |
| --- | --- | --- |
| track.duration / preview.duration / audition_info.duration_ms | **毫秒** | 展示前 /1000 |
| video_model.video_duration | **秒（字符串）** | parseFloat |
| create_time / update_time / time_created / release_date | **unix 秒** | release_date 是日期 0 点 |
| status_info.now / now_ts_ms | 秒 / 毫秒 | 仅排障 |
| video_model.url_expire / track_player.expire_at | **unix 秒** | 播放 URL 过期 |

### 17.3 其它

- track 实体字段很多（album, artists, duration, name, preview, state, stats, vid, label_info, bit_rates, audition_info, limited_free_info, playable_range, media_type, chorus, colors, lang_codes, ...）；渲染只需 id/name/duration/artists/album/state/label_info。
- label_info.only_vip_playable = 仅 VIP 可播全曲（试听仍可能可用）；quality_map 给出各音质条件（need_vip）。
- 可空字段：limited_free_info 常为 null；count_tracks 可能为 null（抖音收藏歌单）；user_digged、preview、artist_profile 可能为 null。
- id 都是字符串（如 "6778775242320906241"），不要转 number（超过 2^53）。
- 榜单/推荐/电台里的曲目可能重复，统一按 track id 去重。

---

## 18. 风险与未解决问题

| # | 问题 | 影响 | 现状/建议 |
| --- | --- | --- | --- |
| 1 | **seo_track 曲目覆盖不是 100%**：20 首实测 3 首无 track_player，重试/换 UA/换 device_platform 都无效 | 部分歌单里个别曲目无法播放 | 判空置灰 + 提示；这是版权/地区限制，非抖动 |
| 2 | VIP-only 曲目只给试听片段（实测 60.001s / 30–60s 不等） | 用户以为能听整曲 | 用 video_duration vs duration 判断并标「试听」；**不要尝试解密** |
| 3 | 试听片段实际起点未知（preview.start 60000ms 但无法验证） | 试听内容可能从曲中开始，进度条映射不准 | 按 0:00 播放并标试听；或直接展示为「试听片段」不显示精确进度 |
| 4 | /luna/pc/search/mixed 始终 1000004（带完整 pcSearchParams 也不行） | 无法做「综合」搜索 tab | 用四个独立端点拼多 tab；不要依赖 mixed |
| 5 | 写操作（收藏/评论/歌单编辑）全部需要签名 | 插件只能只读 | 不实现；UI 不要提供无效按钮 |
| 6 | 收藏专辑非空响应未实测（示例账号为空） | 非空账号的展示字段不确定 | 按参考结构兜底 + 空态处理；上线前用有收藏的账号补测 |
| 7 | comments count 在不同 host/Cookie 下不一致 | 显示的总数可能不准 | 只作参考，翻页用 has_more |
| 8 | artists albums 每页条数不固定、next 跳跃 | 可能漏专辑/重复 | 按 next_cursor 翻页 + album id 去重 |
| 9 | 歌单 count_tracks 抖动且与 metadata 不一致（示例计数会小幅抖动） | 展示数字不准 | 以实际曲目数组长度为准 |
| 10 | 电台 cursor 不稳定、可能空 items | 连续播放可能断 | 去重 + 空 items 重试/结束 |
| 11 | APP discover 依赖 App UA + 公共 query（iid 等）；未来可能失效 | 首页/榜单不可用 | 失败时降级：PC discover/mix 仍可拿歌单；榜单可缓存 |
| 12 | 未做真机 MyGo 集成验证（本任务只测绘） | 运行时 Cookie/网络策略可能不同 | 见 docs/RUNTIME.md；Lead 负责集成验证 |
| 13 | 未验证 aid 之外是否还需 app_name/device_id 等参数（PC 读接口日常可用） | 低 | 保持最小参数；出错再补 |
| 14 | 未实测「单曲收藏列表」「关注艺人列表」等其他个人页 | 功能范围外 | 当前不做 |

---

## 19. 探针工具与夹具

### 19.1 tools/probe-qishui.py

    # 只读探针：读取 MyGo 已登录 Cookie（或 QISHUI_COOKIE），汇总接口状态，不输出凭据
    python3 tools/probe-qishui.py home
    python3 tools/probe-qishui.py search 薛之谦
    python3 tools/probe-qishui.py play 6778775242320906241
    python3 tools/probe-qishui.py playlist 7031081053599074335 --cookie
    python3 tools/probe-qishui.py liked
    python3 tools/probe-qishui.py history
    python3 tools/probe-qishui.py comments 6778775242320906241
    python3 tools/probe-qishui.py album 6778775240618018818
    python3 tools/probe-qishui.py artist 6807264292040083458
    python3 tools/probe-qishui.py radio
    python3 tools/probe-qishui.py all

- 默认只打印「HTTP 状态 / 耗时 / 结构摘要」，URL 与用户信息自动脱敏；--json 输出机器可读结果。
- Cookie 路径默认 ~/Library/Application Support/MyGo Music/plugin-data/qishui/storage.json，可用 --storage 或环境变量 QISHUI_COOKIE 覆盖。
- 不做任何写操作。

### 19.2 fixtures/

| 文件 | 对应接口 | 说明 |
| --- | --- | --- |
| home_discover.json | APP POST /luna/discover | 首页 2 个 block（歌单推荐 + 3 榜单），每块保留 1–2 条示例 |
| home_pc_discover_mix.json | PC POST /luna/pc/discover | 电台列表（2 个电台） |
| home_discover_mix.json | PC POST /luna/pc/discover/mix | 歌单流（1 个 inner） |
| feed_song_tab.json | PC POST /luna/pc/feed/song-tab | 个性化歌曲流（2 首） |
| search_track.json / search_album.json / search_artist.json / search_playlist.json | 4 个搜索端点 | 每组 1 条示例 |
| search_sug.json | GET /luna/pc/sug | 2 条联想 |
| track_detail.json | GET /luna/pc/track_v2 | track 精简 + lyric 前 3 行 |
| play_seo_track.json | GET /luna/h5/seo_track | seo_track + track_player（音频 URL 已替换为占位符） |
| playlist_detail.json | GET /luna/pc/playlist/detail | 我喜欢歌单 + 2 首曲目（owner 已脱敏） |
| me_playlist.json | GET /luna/pc/me/playlist | 我的歌单列表（2 个，owner 已脱敏） |
| history.json | GET /luna/pc/me/recently-played-media | 历史 2 条 + 分页字段 |
| comments.json | GET /luna/comments | 评论 2 条（用户已脱敏） |
| album.json | GET /luna/pc/albums/{id} | 专辑 + 2 首曲目 |
| artist.json | GET /luna/pc/artists/{id} | 艺人详情（长文本裁剪） |
| radio_tracks.json | POST /luna/pc/feed/radio/tracks | 电台曲目 2 首 |
| collection_empty.json | GET /luna/pc/me/collection/mixed | 空收藏形状 |
| errors.json | 多端点 | 错误信封样本（已去 log_id） |

> fixtures 中所有账号昵称/uid、头像签名 URL、音频签名 URL、log_id 均已脱敏；只保留公开的曲目/专辑/艺人元数据与结构。

---

## 附录 A：端点总表

| # | 能力 | Method | Host + Path | 关键参数 | Cookie | aid | 置信度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 首页 + 榜单 | POST | {APP}/luna/discover | body {} + APPQ | 否 | APPQ 内 | ✅ |
| 2 | 歌单流 | POST | {PC}/luna/pc/discover/mix | {} | 否 | 否 | ✅ |
| 3 | 电台列表 | POST | {PC}/luna/pc/discover | {first_request:true,pc_new_discover_request:true} | 否 | 否 | ✅ |
| 4 | 个性化歌曲流 | POST | {PC}/luna/pc/feed/song-tab | {cursor,count} | 否 | 否 | ⚠️ |
| 5 | 场景模式 | POST | {PC}/luna/feed/mode | {} | 否 | 否 | ⚠️ |
| 6 | 搜索-歌曲 | GET | {PC}/luna/pc/search/track | q,cursor | 否 | 可选 | ✅ |
| 7 | 搜索-专辑 | GET | {PC}/luna/pc/search/album | q,cursor | 否 | 可选 | ✅ |
| 8 | 搜索-艺人 | GET | {PC}/luna/pc/search/artist | q,cursor | 否 | 可选 | ✅ |
| 9 | 搜索-歌单 | GET | {PC}/luna/pc/search/playlist | q,cursor | 否 | 可选 | ✅ |
| 10 | 搜索联想 | GET | {PC}/luna/pc/sug | q | 否 | 可选 | ✅ |
| 11 | 播放（明文 URL） | GET | {APP}/luna/h5/seo_track | track_id,device_platform=web，Web UA | 可选 | 否 | ✅（覆盖 ⚠️） |
| 12 | 播放元数据/歌词 | GET | {PC}/luna/pc/track_v2 | track_id,media_type,queue_type | **否** | 否 | ✅ |
| 13 | 歌单详情 | GET | {PC}/luna/pc/playlist/detail | playlist_id,cursor,count | 见矩阵 | **带 Cookie 必填** | ✅ |
| 14 | 登录态 | GET | {PC}/luna/pc/me | — | 是 | 是 | ✅ |
| 15 | 我的歌单 | GET | {PC}/luna/pc/me/playlist | cursor,count | 是 | 是 | ✅ |
| 16 | 历史 | GET | {PC}/luna/pc/me/recently-played-media | cursor,count | 是 | 是 | ✅ |
| 17 | 收藏专辑 | GET | {PC}/luna/pc/me/collection/mixed | cursor,count,item_types | 是 | 是 | ⚠️ |
| 18 | 专辑详情 | GET | {PC}/luna/pc/albums/{album_id} | — | 否 | 否 | ✅ |
| 19 | 艺人详情 | GET | {PC}/luna/pc/artists/{artist_id} | — | 否 | 否 | ✅ |
| 20 | 艺人曲目 | GET | {PC}/luna/pc/artists/{id}/tracks | cursor | 否 | 否 | ✅ |
| 21 | 艺人专辑 | GET | {PC}/luna/pc/artists/{id}/albums | cursor | 否 | 否 | ⚠️ |
| 22 | 电台曲目 | POST | {PC}/luna/pc/feed/radio/tracks | radio_id,count,cursor,flow_type | 否 | 否 | ⚠️ |
| 23 | 评论 | GET | {APP}/luna/comments 或 {PC}/luna/pc/comments | group_id,group_type=0,cursor,count,image_strategy=2 | 可选 | 匿名即可（PC 签名后仍可读） | ✅ |
| 24 | 歌词 | 同 11/12 | lyric.content | — | 可选 | — | ✅ |
| 25 | 媒体加密流（不可播） | POST | {APP}/luna/media-player 或 {PC}/luna/pc/track_v2 | — | — | — | ⚠️ 仅元数据 |

## 附录 A2：官方签名写接口（2026-11-09 实测，需 Cookie + X-Helios/X-Medusa + X-SS-STUB）

PC 写接口与 track_v2 使用同一套签名（UA `LunaPC/3.7.0(452316191)`、query 带 device_id/iid、
version_code 30070000；`X-SS-STUB` = body JSON 的大写 MD5）。Cookie 要用
`name=value; ...` 字符串，直接传对象会得到 1000016「登录状态已失效」。

| # | 用途 | 方法 | 路径 | body | 返回要点 |
| --- | --- | --- | --- | --- | --- |
| 26 | 收藏歌曲 | POST | {PC}/luna/pc/me/collection/media | `{"scene":"","media":[{"id":"<track>","type":"track"}]}` | `collected_media[]` + `playlist{id:<liked-playlist-id>}` |
| 27 | 取消收藏 | POST | {PC}/luna/pc/me/collection/media/delete | `{"media":[{"id":"<track>","type":"track"}]}` | `deleted_media[]` + `playlist` |
| 28 | 播放上报 | POST | {PC}/luna/pc/me/recently-played-media | `{"media":[{"type":"track","id":"<track>"}]}` | 200；该路径签名头 `X-Luna-Is-Local-User: 1`（其它路径为 0） |
| 29 | 播放地址（签名） | POST | {PC}/luna/pc/track_v2 | `{"track_id":"<track>","media_type":"track","queue_type":"favorite_track_playlist","scene_name":"library"}` | 完整时长 `video_model.video_list[]`，每档 `encrypt_info{spade_a,kid,cenc-aes-ctr}` |

## 附录 B：实测样本 ID（公开目录内容；账号相关 ID 已替换为占位符）

| 类型 | ID | 说明 |
| --- | --- | --- |
| track | 6778775242320906241 | 我好像在哪见过你（VIP-only，有试听） |
| track | 7699411877051320320 | 多远都要在一起（VIP-only，试听 60s，见 fixtures/play_seo_track.json） |
| track | 7428116489662482433 | 仅 1 档音质（higher）样本 |
| album | 6778775240618018818 | 初学者 |
| artist | 6807264292040083458 | 薛之谦（count_albums=67, count_tracks=144） |
| playlist（公开） | 7031081053599074335 | 22 首可播 / 25 槽位（分页坑样本） |
| playlist（喜欢） | <liked-playlist-id> | type=1, is_private=true；需 Cookie+aid（真实 ID 属于账号数据，不保留） |
| playlist（抖音收藏） | <douyin-playlist-id> | type=4（真实 ID 属于账号数据，不保留） |
| 榜单 | 7036274230471712007 / 7060812597884869927 / 7061475546400005410 | 热歌榜 / 新歌榜 / 欧美榜 |
| 电台 | 7408841207004184603 | 热情布鲁斯 |

---

## 附录 A3：评论（PC 路由，2026-11-09 真机验证）

读取：GET {PC}/luna/pc/comments，query group_id=<track>&group_type=0&cursor=&count=20&image_strategy=2。
匿名请求即可返回 200；带 Cookie 的签名请求同样 200（签名 GET 的签名覆盖 URL + 实际请求头，
method=GET、无 body、无 Content-Type）。响应字段：

    { count, cursor, has_more,
      comments: [{ id, content, count_digged, time_created(秒),
                   user:{ nickname, thumb_avatar_url:{urls[],uri,template_prefix,need_complete_url} },
                   user_artist_info:{ artist_brief:{name,url_avatar,thumb_avatar_url} },
                   count_reply, featured, visibility, ip_label }] }

- id 是 19 位雪花 ID，解析时要按字符串处理；time_created 是秒，传给 App 前 ×1000。
- 头像优先用 urls[0]（need_complete_url=true 时已是完整 https）；否则
  urls[0] + uri + "~" + template_prefix + "-crop-center:100:100.jpg"。
- 当前服务端不返回 user_digged（无论匿名还是签名请求），因此“我是否点过赞”无法从
  API 得知；App 侧只在本次点按时本地更新，刷新后回到未点亮。count_digged 是服务端点赞数。

点赞：POST {PC}/luna/pc/comments/action（签名）body
{"comment_id":"<id>","reply_id":"","group_id":"<track>","type":1,"scene_name":"comment_detail"}，
取消用 type:3；成功返回 {status_info, liked_comment:"<id>"}，两种操作返回字段相同，以请求的
type 为准。

发表：POST {PC}/luna/pc/comments/create（签名）body
{"group_id":"<track>","group_type":0,"comment_type":0,"text":"...","hashtags":[],
"reply_id":"","reply_to_reply_id":"","reply_to_user_id":"","text_extra":[]}；
成功返回 {status_info, created_comment:"<19位ID>"}，ID 为 0 或缺失视为失败。

---

## 附录 A4：歌单 / 收藏 / 关注写接口（签名）

以下端点均需要 X-Helios/X-Medusa 签名（见附录 A2）。统一前置条件：已登录，cookie 来自
插件 storage 的 session jar；写请求体 JSON 需带 `X-SS-STUB = md5(body).toUpperCase()`。
返回里的 status_code 为 0 即成功，失败一般是 1000006（无权限）或 1000002（参数）。

| # | 方法 | 路径（{PC} = https://api.qishui.com） | body / query | 成功返回（关键字段） |
|---|------|--------------------------------------|--------------|----------------------|
| 30 | POST | /luna/pc/me/playlist | {"name":"歌单名","is_private":false,"media":[]} | playlist{id,title,type,owner,track_count,url_cover,...} |
| 31 | POST | /luna/pc/me/playlist/update | {"playlist_id":"<id>","name":"新名字"} | playlist_id, name, playlist |
| 32 | POST | /luna/pc/me/playlist/delete | {"playlist_ids":["<id>"]} | deleted_playlists |
| 33 | POST | /luna/pc/me/playlist/media/append | {"playlist_id":"<id>","media":[{"id":"<track>","type":"track"}]} | media, playlist{count_tracks} |
| 34 | POST | /luna/pc/me/playlist/media/delete | 同上 | media（剩余）, playlist{count_tracks} |
| 35 | POST | /luna/me/playlist/media/sort | {"playlist_id":"<id>","media":[{"id":"<track>","type":"track"},...]}（完整顺序） | media（新顺序） |
| 36 | POST | /luna/pc/me/collection/playlist | {"playlist_ids":["<id>"]} | playlist_ids |
| 37 | POST | /luna/pc/me/collection/playlist/delete | {"playlist_ids":["<id>"]} | deleted_playlists |
| 38 | POST | /luna/pc/me/collection/album | {"album_ids":["<id>"]} | collected_albums |
| 39 | POST | /luna/pc/me/collection/album/delete | {"album_ids":["<id>"]} | deleted_albums |
| 40 | POST | /luna/pc/me/collection/artist | {"artist_ids":["<id>"]} | artist_ids, collect_artist_status |
| 41 | POST | /luna/pc/me/collection/artist/delete | {"artist_ids":["<id>"]} | deleted_artists, deleted_artist_status |
| 42 | GET | /luna/pc/me/collection/mixed | cursor, count, item_types=playlist（或 album，可重复同名参数） | mixed_collections[{item_type,playlist|album}] |
| 43 | GET | /luna/pc/me/collection/artist | cursor, count | artists[], total_num, next_cursor |

要点：
- 收藏（他人）歌单不出现在 unsigned 的 `/luna/me/playlist`（该端点只回自己的歌单），必须用
  #42 的 mixed 列表；收藏/取消收藏有 1–3s 最终一致性延迟。
- #42 的 `item_types` 是重复同名 query（`item_types=playlist&item_types=album`），
  插件 `sortedQuery` 对数组值逐个 `encodeURIComponent` 后重复拼接。
- 歌单编辑只允许自己创建的普通歌单（type ∈ {2,3,11}）；type 1（我喜欢）只能通过
  `/luna/pc/me/collection/media` 加/删歌曲；type 4（抖音收藏）固定，不可改。
- #35 排序提交完整歌曲顺序，插件在任一元素不是 track 时放弃，避免丢歌。
- 评论没有回复/楼中楼接口：#42 之外对 /luna/pc/comments 传 reply_id 等参数会被忽略，
  /luna/pc/comments/reply、/replies、/detail 均 404；宿主 MyGo 的 Comment 结构也没有
  回复字段与 UI，因此插件范围内不实现评论回复。
- 离线下载不需要插件写接口：宿主歌曲菜单的 Download… 会在 `stream` 返回 file://
  后直接拷到用户选择的位置。

---

## 附录 A5：PC 听歌模式 / 发现（2026-11-10 实测，匿名或 Cookie 均可）

| # | 方法 | 路径 | 请求体 / query | 响应要点 |
| --- | --- | --- | --- | --- |
| 44 | POST | {PC}/luna/pc/feed/mode | `{}` | `feed_mode_block[0].feed_mode[]`：`text`、`entity.feed_scene_mode.scene_mode_id`、`url_info`（封面模板）；常用 scene: 3/5/6/9/33/34 |
| 45 | POST | {PC}/luna/pc/discover | `{"first_request":true,"pc_new_discover_request":true}` | `blocks[].inner_block[].resources[]`：`type="radio"` 用 `resource_id` 作电台 ID，`style.title/desc/cover_url_list` 展示；`type="playlist"` 用 `entity.playlist` |
| 46 | POST | {PC}/luna/pc/discover/mix | `{}` | `inner_block[]`（`discover_playlist`），资源在 `resource.entity.playlist`，封面在 `style.cover_url` 或 playlist |
| 47 | POST | {PC}/luna/pc/feed/radio/tracks | `{"radio_id":"<id>","count":6,"flow_type":1|2}`，翻页可带 `cursor` | `items[].entity.track_wrapper.track`、`has_more`、`next_cursor`；`style.type===6`→`flow_type=1`，否则 `flow_type=2`，不传会得到无关推荐流 |
| 48 | POST | {PC}/luna/pc/feed/song-tab | `{"played_media":[{"type":"track","media_id":"<id>","duration":秒,"played_mills":-1}],"is_first_request":true,"is_did_first_request":false,"feed_counts":{"mix_session_count":1},"feed_preference":{"preference_mode":"familiar"}}` | `items[]` 6 首、`has_more`；`cursor` 是已获取条数，页间会重叠，必须去重 |

要点：
- `feed_preference` 可为 `{"preference_mode":"familiar"|"fresh"}` 或 `{"scene_mode_id":3|5|6|9|33|34}`；不传则为私人推荐。
- 听歌模式页 UI 对应：常用模式（熟悉/新鲜/抖音漫游/摸鱼/驾车/快乐时光/Chill 放松/专注）+ 探索电台；`stations()` 合并两者，`stationNext` 按 id 分流到 #48 / #47。
- 这些 PC 接口用普通 Cookie 即可，不需要官方签名；因此非 macOS 也能读元数据（播放仍受平台限制）。
- `feed/song-tab` 的 `predict_info` 等字段含长小数，插件 `parseData` 必须只对 ≥16 位整数字面量加引号，不能把小数部分拆开，否则 JSON 解析失败。

---

*测绘时间：2026-11-09；接口行为可能随后端版本变化，上线前请以 tools/probe-qishui.py 复跑并更新本文档。*
