# fixtures

本目录是 docs/API.md 的响应形状样本（2026-11-09 抓取），仅用于对照字段结构。

- 已合成/脱敏：账号昵称与 uid、头像、评论原文与作者、评论时间与地区、私密歌单 ID、
  听歌历史、「喜欢」曲目条目与私密歌单封面，全部替换为虚构数据；曲目 vid、试听 audition_info.vid、
  音频 file_id/file_hash、limited_free_info.sign 等签名/资源值也替换为合成值；
  评论计数、试听起点等实测数值改为示例值；
  曲目/专辑/艺人/榜单等公开目录 ID 保留原值，便于按文档复跑调试。
- 音频/头像签名 URL、Cookie、log_id、签名请求头一律不在样本中。
- 每个文件对应 docs/API.md 中同名的接口说明；字段裁剪只保留结构示例。
- 复跑校验：`python3 tools/probe-qishui.py <command>`，或 `python3 tools/probe-qishui.py all`。
- 注意：样本中的 ID、时间、数量、用户和评论均为演示用途，不代表真实账号；用真实账号探测后
  必须替换成虚构样本再提交。

| 文件 | 接口 |
| --- | --- |
| home_discover.json | POST {APP}/luna/discover（首页 + 3 榜单） |
| home_pc_discover_mix.json | POST {PC}/luna/pc/discover（电台列表） |
| home_discover_mix.json | POST {PC}/luna/pc/discover/mix（歌单流） |
| feed_song_tab.json | POST {PC}/luna/pc/feed/song-tab |
| search_track.json / search_album.json / search_artist.json / search_playlist.json | 4 个搜索端点 |
| search_sug.json | GET /luna/pc/sug |
| track_detail.json | GET /luna/pc/track_v2 |
| play_seo_track.json | GET /luna/h5/seo_track（播放 URL 已替换为占位符） |
| playlist_detail.json | GET /luna/pc/playlist/detail（条目已合成） |
| me_playlist.json | GET /luna/pc/me/playlist（歌单 ID 已合成） |
| history.json | GET /luna/pc/me/recently-played-media（条目已合成） |
| comments.json | GET /luna/comments（评论内容/作者/地区已合成） |
| album.json | GET /luna/pc/albums/{id} |
| artist.json | GET /luna/pc/artists/{id} |
| radio_tracks.json | POST /luna/pc/feed/radio/tracks |
| collection_empty.json | GET /luna/pc/me/collection/mixed（空收藏形状） |
| errors.json | 错误信封样本（4 类错误码） |
