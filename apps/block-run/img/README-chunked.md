# music.mp3 分片说明

原始 music.mp3 (4,557,116 bytes) 因代理上传大小限制无法作为单个 blob 推送，
被拆分为 music.mp3.partaa (3,000,000) + music.mp3.partab (1,557,116)。

应用引用的 `img/music.mp3` 不存在会退化为无背景音乐（block-run 对 mp3 缺失已容错）。
恢复方法（本地合并）：

    cat music.mp3.partaa music.mp3.partab > music.mp3

合并后可删除 part 文件并重新提交替换。
