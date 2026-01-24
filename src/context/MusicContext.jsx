import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useSettings } from './SettingsContext';
import fileStorageService from '@/lib/fileStorageService';

const MusicContext = createContext();

export function useMusic() {
  return useContext(MusicContext);
}

export function MusicProvider({ children }) {
  const { musicConfig, updateMusicConfig } = useSettings();
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playlist, setPlaylist] = useState([]);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [createdUrls, setCreatedUrls] = useState([]);
  const [volume, setVolume] = useState(0.8);
  // 待播放信息：避免 URL 在后续被 S3 替换导致找不到，增加标题+歌手回退匹配
  const pendingPlayRef = useRef(null); // { url, title, artist }
  const restoredRef = useRef(false);

  // 清理创建的对象URL
  useEffect(() => {
    return () => {
      createdUrls.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          console.warn('Failed to revoke URL:', url, error);
        }
      });
    };
  }, [createdUrls]);

  // 添加URL到清理列表
  const addUrlToCleanup = (url) => {
    if (url && url.startsWith('blob:')) {
      setCreatedUrls(prev => [...prev, url]);
    }
  };

  // 重新生成本地文件的URL（仅处理S3文件）
  const regenerateLocalUrls = (songs) => {
    return songs.map(song => {
      const updatedSong = { ...song };

      // 处理音频文件（仅S3文件）
      if (song.audioFile && song.audioFile.storageType === 's3' && song.audioFile.url) {
        updatedSong.musicUrl = song.audioFile.url;
      }

      // 处理图片文件（仅S3文件）
      if (song.imageFile && song.imageFile.storageType === 's3' && song.imageFile.url) {
        updatedSong.coverUrl = song.imageFile.url;
      }

      return updatedSong;
    });
  };

  // 获取完整的音乐列表（包括内置和自定义）
  const getMusicList = () => {
    const builtinSongs = [
      {
        id: 'builtin-flower',
        title: '鲜花',
        artist: '回春丹',
        musicUrl: 'https://pic.lover.nyc.mn/2025-08/回春丹 - 鲜花_1755699293512.flac',
        coverUrl: '/images/xh.jpg',
        lyrics: 'builtin',
        isBuiltin: true
      }
    ];

    // 重新生成本地文件的URL
    const customSongs = regenerateLocalUrls(musicConfig.customSongs || []).map((song, index) => ({
      ...song,
      id: `custom-${index}`,
      isBuiltin: false
    }));

    return [...builtinSongs, ...customSongs];
  };

  // 当音乐配置变化时更新播放列表
  useEffect(() => {
    const newPlaylist = getMusicList();
    setPlaylist(newPlaylist);

    // 如果播放列表为空，重置状态
    if (newPlaylist.length === 0) {
      setCurrentSongIndex(0);
      setIsPlaying(false);
      return;
    }

    // 尝试在首次加载时恢复上次播放（按 URL 回退到 标题+歌手）
    if (!restoredRef.current && newPlaylist.length > 0) {
      try {
        const raw = localStorage.getItem('music:lastPlayed');
        if (raw) {
          const last = JSON.parse(raw);
          let idx = -1;
          if (last?.musicUrl) {
            idx = newPlaylist.findIndex(s => s.musicUrl && s.musicUrl === last.musicUrl);
          }
          if (idx < 0) {
            const t = (last?.title || '').trim();
            const a = (last?.artist || '').trim();
            idx = newPlaylist.findIndex(s => (s.title || '').trim() === t && (s.artist || '').trim() === a);
          }
          if (idx >= 0) setCurrentSongIndex(idx);
        }
      } catch { }
      restoredRef.current = true;
    } else {
      // 若当前播放的歌曲不在新列表中，重置到第一首
      if (currentSongIndex >= newPlaylist.length) {
        setCurrentSongIndex(0);
      }
      // 如果没有当前歌曲且播放列表不为空，选择第一首
      if (currentSongIndex === 0 && newPlaylist.length > 0) {
        setCurrentSongIndex(0);
      }
    }
    // 若存在挂起的待播 URL，则尝试定位并播放
    const pending = pendingPlayRef.current;
    if (pending) {
      let idx = newPlaylist.findIndex(s => s.musicUrl === pending.url);
      if (idx < 0) {
        const t = (pending.title || '').trim();
        const a = (pending.artist || '').trim();
        idx = newPlaylist.findIndex(s => (s.title || '').trim() === t && (s.artist || '').trim() === a);
      }
      if (idx >= 0) {
        // 直接基于 newPlaylist 进行播放，避免依赖可能滞后的 playlist state
        try {
          setCurrentSongIndex(idx);
          setIsPlaying(true);
          const s = newPlaylist[idx];
          try {
            localStorage.setItem('music:lastPlayed', JSON.stringify({
              title: s.title,
              artist: s.artist,
              musicUrl: s.musicUrl,
              coverUrl: s.coverUrl,
              lyrics: s.lyrics || ''
            }));
          } catch { }
          try {
            window.dispatchEvent(new CustomEvent('music:pause-others'));
            window.dispatchEvent(new CustomEvent('music:play', {
              detail: {
                title: s.title,
                artist: s.artist,
                musicUrl: s.musicUrl,
                coverUrl: s.coverUrl
              }
            }));
          } catch (error) {
            console.error('Failed to dispatch music:play event:', error);
          }
        } finally {
          pendingPlayRef.current = null;
        }
      }
    }
  }, [musicConfig]);

  // 从localStorage加载音量设置
  useEffect(() => {
    const savedVolume = localStorage.getItem('musicVolume');
    if (savedVolume) {
      try {
        const volumeValue = parseFloat(savedVolume);
        if (!isNaN(volumeValue) && volumeValue >= 0 && volumeValue <= 1) {
          setVolume(volumeValue);
        }
      } catch (error) {
        console.warn('Failed to parse music volume:', error);
      }
    }
  }, []);

  // 保存音量设置到localStorage
  useEffect(() => {
    localStorage.setItem('musicVolume', volume.toString());
  }, [volume]);

  // 播放指定歌曲
  const playSong = (index) => {
    if (index >= 0 && index < playlist.length) {
      setCurrentSongIndex(index);
      setIsPlaying(true);
      // 记录上次播放（仅本地）
      try {
        const s = playlist[index];
        localStorage.setItem('music:lastPlayed', JSON.stringify({
          title: s.title,
          artist: s.artist,
          musicUrl: s.musicUrl,
          coverUrl: s.coverUrl,
          lyrics: s.lyrics || ''
        }));
      } catch { }
      // 请求迷你播放器如有需要可自行在 loadedmetadata 恢复进度

      // 通知全局播放器切换歌曲
      try {
        // 先暂停其他播放器
        window.dispatchEvent(new CustomEvent('music:pause-others'));
        // 然后开始播放
        window.dispatchEvent(new CustomEvent('music:play', {
          detail: {
            title: playlist[index].title,
            artist: playlist[index].artist,
            musicUrl: playlist[index].musicUrl,
            coverUrl: playlist[index].coverUrl
          }
        }));
      } catch (error) {
        console.error('Failed to dispatch music:play event:', error);
      }
    }
  };

  // 播放下一首
  const playNext = () => {
    const nextIndex = (currentSongIndex + 1) % playlist.length;
    playSong(nextIndex);
  };

  // 播放上一首
  const playPrevious = () => {
    const prevIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
    playSong(prevIndex);
  };

  // 暂停/恢复播放
  const togglePlay = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    // 当从暂停切换到播放时，写入 lastPlayed（避免仅点击播放不切歌时 lastPlayed 不更新）
    if (next) {
      try {
        const s = playlist[currentSongIndex];
        if (s) {
          localStorage.setItem('music:lastPlayed', JSON.stringify({
            title: s.title,
            artist: s.artist,
            musicUrl: s.musicUrl,
            coverUrl: s.coverUrl,
            lyrics: s.lyrics || ''
          }));
        }
      } catch { }
    }
    try {
      window.dispatchEvent(new CustomEvent(isPlaying ? 'music:pause' : 'music:play'));
    } catch (error) {
      console.error('Failed to dispatch play/pause event:', error);
    }
  };

  // 播放外部歌曲：若已在列表则直接播放；否则追加到自定义歌曲后自动播放
  const playExternalSong = (song) => {
    if (!song || !song.musicUrl) return;
    // 先尝试按 URL 定位
    let existsIndex = playlist.findIndex(s => s.musicUrl === song.musicUrl);
    // 若 URL 不同（如一份是 S3，一份是 API 源），则退化用 标题+歌手 去匹配
    if (existsIndex < 0) {
      const t = (song.title || '').trim();
      const a = (song.artist || '').trim();
      existsIndex = playlist.findIndex(s => (s.title || '').trim() === t && (s.artist || '').trim() === a);
    }
    if (existsIndex >= 0) {
      playSong(existsIndex);
      return;
    }
    try {
      const next = [...(musicConfig?.customSongs || []), {
        title: song.title || '未知标题',
        artist: song.artist || '未知艺术家',
        musicUrl: song.musicUrl,
        coverUrl: song.coverUrl || '',
        lyrics: song.lyrics || '',
        ...(song.audioFile ? { audioFile: song.audioFile } : {}),
        ...(song.imageFile ? { imageFile: song.imageFile } : {})
      }];
      pendingPlayRef.current = { url: song.musicUrl, title: song.title, artist: song.artist };
      updateMusicConfig({ customSongs: next, lastModified: new Date().toISOString() });
    } catch (e) {
      console.error('Failed to add external song:', e);
    }
  };

  // 设置播放状态
  const setPlayingState = (playing) => {
    setIsPlaying(playing);
  };

  // 获取当前歌曲
  const getCurrentSong = () => {
    return playlist[currentSongIndex] || null;
  };

  // 监听全局播放状态事件
  useEffect(() => {
    const handleGlobalPlay = () => setPlayingState(true);
    const handleGlobalPause = () => setPlayingState(false);
    const handleGlobalDisable = () => {
      setPlayingState(false);
      setCurrentSongIndex(0);
    };
    const handleGlobalPlaying = (e) => {
      if (e.detail && typeof e.detail.playing === 'boolean') {
        setPlayingState(e.detail.playing);
      }
    };

    window.addEventListener('music:playing', handleGlobalPlaying);
    window.addEventListener('music:play', handleGlobalPlay);
    window.addEventListener('music:pause', handleGlobalPause);
    window.addEventListener('music:globalDisable', handleGlobalDisable);

    return () => {
      window.removeEventListener('music:playing', handleGlobalPlaying);
      window.removeEventListener('music:play', handleGlobalPlay);
      window.removeEventListener('music:pause', handleGlobalPause);
      window.removeEventListener('music:globalDisable', handleGlobalDisable);
    };
  }, []);

  // 设置音量
  const setMusicVolume = (newVolume) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
  };

  // 从播放列表删除一首自定义歌曲（按索引）
  const deleteSongAtIndex = async (index) => {
    const song = playlist[index];
    if (!song || song.isBuiltin) return; // 内置歌曲不可删除

    try {
      // 删除关联存储文件（若有）
      if (song.audioFile) {
        try { await fileStorageService.deleteFile(song.audioFile); } catch { }
      }
      if (song.imageFile) {
        try { await fileStorageService.deleteFile(song.imageFile); } catch { }
      }

      // 过滤掉该歌曲
      const nextCustom = (musicConfig?.customSongs || []).filter(cs => {
        if (song.musicUrl && cs.musicUrl && cs.musicUrl === song.musicUrl) return false;
        return !(cs.title === song.title && (cs.artist || '') === (song.artist || ''));
      });

      // 若正在播放被删除的歌曲，先暂停
      if (index === currentSongIndex) {
        setIsPlaying(false);
        try { window.dispatchEvent(new CustomEvent('music:pause')); } catch { }
      } else if (index < currentSongIndex) {
        // 往前删除会影响索引
        setCurrentSongIndex(Math.max(0, currentSongIndex - 1));
      }

      updateMusicConfig({ customSongs: nextCustom, lastModified: new Date().toISOString() });
    } catch (e) {
      console.error('Failed to delete song from playlist:', e);
    }
  };

  return (
    <MusicContext.Provider value={{
      currentSongIndex,
      playlist,
      isPlaying,
      showPlaylist,
      setShowPlaylist,
      playSong,
      playNext,
      playPrevious,
      togglePlay,
      setPlayingState,
      getCurrentSong,
      volume,
      setVolume: setMusicVolume,
      playExternalSong,
      deleteSongAtIndex
    }}>
      {children}
    </MusicContext.Provider>
  );
}