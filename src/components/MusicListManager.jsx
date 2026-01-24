import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, Music, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import fileStorageService from '@/lib/fileStorageService';
import s3StorageService from '@/lib/s3Storage';

export default function MusicListManager({ musicConfig, updateMusicConfig }) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  const [createdUrls, setCreatedUrls] = useState([]);
  const [musicList, setMusicList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    musicUrl: '',
    coverUrl: '',
    lyrics: '',
    audioFile: null,
    imageFile: null
  });

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

  // 初始化文件存储服务
  useEffect(() => {
    if (musicConfig && musicConfig.s3Config) {
      fileStorageService.init(musicConfig.s3Config);
    }
  }, [musicConfig]);

  // 异步加载音乐列表
  useEffect(() => {
    const loadMusicList = async () => {
      try {
        setIsLoading(true);
        const list = await getMusicList();
        setMusicList(list);
      } catch (error) {
        console.error('Failed to load music list:', error);
        toast.error('加载音乐列表失败');
      } finally {
        setIsLoading(false);
      }
    };

    loadMusicList();
  }, [musicConfig]);

  // 添加URL到清理列表
  const addUrlToCleanup = (url) => {
    if (url && url.startsWith('blob:')) {
      setCreatedUrls(prev => [...prev, url]);
    }
  };

  // 获取音乐列表（包括内置和自定义）
  const getMusicList = async () => {
    const builtinSongs = [
      {
        id: 'builtin-flower',
        title: '鲜花',
        artist: '回春丹',
        musicUrl: 'https://pic.lover.nyc.mn/2025-08/回春丹 - 鲜花_1755699293512.flac', // 假设的音频文件路径
        coverUrl: '/images/xh.jpg',
        lyrics: 'builtin',
        isBuiltin: true
      }
    ];

    // 重新生成本地文件的URL
    const regeneratedCustomSongs = await regenerateLocalUrls(musicConfig.customSongs || []);
    const customSongs = regeneratedCustomSongs.map((song, index) => ({
      ...song,
      id: `custom-${index}`,
      isBuiltin: false
    }));

    return [...builtinSongs, ...customSongs];
  };

  const handleAddSong = async () => {
    if (!formData.title.trim()) {
      toast.error('请输入歌曲名称');
      return;
    }

    toast.loading('正在保存歌曲...', { id: 'saving-song' });

    try {
      // 处理音频文件（如果有）
      let processedAudioFile = null;
      if (formData.audioFile) {
        processedAudioFile = await processFileForStorage(formData.audioFile);
      }

      // 处理图片文件（如果有）
      let processedImageFile = null;
      if (formData.imageFile) {
        processedImageFile = await processFileForStorage(formData.imageFile);
      }

      const newSong = {
        title: formData.title.trim(),
        artist: formData.artist.trim() || '未知艺术家',
        musicUrl: formData.musicUrl.trim(),
        coverUrl: formData.coverUrl.trim(),
        lyrics: formData.lyrics.trim(),
        audioFile: processedAudioFile,
        imageFile: processedImageFile,
        createdAt: new Date().toISOString()
      };

      const updatedSongs = [...(musicConfig.customSongs || []), newSong];
      updateMusicConfig({
        customSongs: updatedSongs,
        lastModified: new Date().toISOString()
      });

      setFormData({
        title: '',
        artist: '',
        musicUrl: '',
        coverUrl: '',
        lyrics: '',
        audioFile: null,
        imageFile: null
      });
      setIsAddDialogOpen(false);
      toast.success('歌曲添加成功', { id: 'saving-song' });
    } catch (error) {
      console.error('Failed to save song:', error);
      toast.error('保存歌曲失败', { id: 'saving-song' });
    }
  };

  const handleEditSong = (song) => {
    setEditingSong(song);
    setFormData({
      title: song.title,
      artist: song.artist,
      musicUrl: song.musicUrl,
      coverUrl: song.coverUrl,
      lyrics: song.lyrics || '',
      audioFile: song.audioFile || null,
      imageFile: song.imageFile || null
    });
  };

  const handleUpdateSong = async () => {
    if (!formData.title.trim()) {
      toast.error('请输入歌曲名称');
      return;
    }

    toast.loading('正在更新歌曲...', { id: 'updating-song' });

    try {
      const updatedSongs = await Promise.all((musicConfig.customSongs || []).map(async (song) => {
        if (song.title === editingSong.title && song.artist === editingSong.artist) {
          // 处理音频文件（如果有更新）
          let processedAudioFile = song.audioFile;
          if (formData.audioFile && formData.audioFile.file) {
            processedAudioFile = await processFileForStorage(formData.audioFile);
          }

          // 处理图片文件（如果有更新）
          let processedImageFile = song.imageFile;
          if (formData.imageFile && formData.imageFile.file) {
            processedImageFile = await processFileForStorage(formData.imageFile);
          }

          return {
            ...song,
            title: formData.title.trim(),
            artist: formData.artist.trim() || '未知艺术家',
            musicUrl: formData.musicUrl.trim(),
            coverUrl: formData.coverUrl.trim(),
            lyrics: formData.lyrics.trim(),
            audioFile: processedAudioFile,
            imageFile: processedImageFile,
            updatedAt: new Date().toISOString()
          };
        }
        return song;
      }));

      updateMusicConfig({
        customSongs: updatedSongs,
        lastModified: new Date().toISOString()
      });

      setEditingSong(null);
      setFormData({
        title: '',
        artist: '',
        musicUrl: '',
        coverUrl: '',
        lyrics: '',
        audioFile: null,
        imageFile: null
      });
      toast.success('歌曲更新成功', { id: 'updating-song' });
    } catch (error) {
      console.error('Failed to update song:', error);
      toast.error('更新歌曲失败', { id: 'updating-song' });
    }
  };

  const handleDeleteSong = async (songToDelete) => {
    try {
      // 删除音频文件
      if (songToDelete.audioFile) {
        await fileStorageService.deleteFile(songToDelete.audioFile);
      }

      // 删除图片文件
      if (songToDelete.imageFile) {
        await fileStorageService.deleteFile(songToDelete.imageFile);
      }

      // 然后删除歌曲记录
      const updatedSongs = (musicConfig.customSongs || []).filter(song =>
        !(song.title === songToDelete.title && song.artist === songToDelete.artist)
      );

      updateMusicConfig({
        customSongs: updatedSongs,
        lastModified: new Date().toISOString()
      });

      toast.success('歌曲删除成功');
    } catch (error) {
      console.error('Failed to delete song:', error);
      toast.error('删除歌曲失败');
    }
  };

  // 处理文件用于存储（强制使用S3）
  const processFileForStorage = async (fileInfo) => {
    // 如果已经有S3存储信息，直接返回
    if (fileInfo.storageType === 's3' && fileInfo.url) {
      return fileInfo;
    }

    // 如果有文件对象，强制使用S3上传
    if (fileInfo.file) {
      try {
        // 检查S3是否已配置
        if (!s3StorageService.isConfigured()) {
          throw new Error('请先在设置中配置S3存储');
        }

        const onProgress = (stage, progress) => {
          switch (stage) {
            case 'start':
              toast.loading('正在处理文件...', { id: 'processing-file' });
              break;
            case 'uploading':
              toast.loading(`正在上传到S3... ${progress}%`, { id: 'processing-file' });
              break;
            case 'complete':
              toast.success('文件已上传到S3', { id: 'processing-file' });
              break;
            case 'error':
              toast.error('文件处理失败', { id: 'processing-file' });
              break;
          }
        };

        const result = await s3StorageService.uploadFile(fileInfo.file, {
          type: fileInfo.type || 'file',
          onProgress
        });

        // 合并原始文件信息
        return {
          ...fileInfo,
          ...result,
          file: null // 移除文件对象引用
        };
      } catch (error) {
        console.error('Failed to process file:', error);
        toast.error('文件处理失败: ' + error.message, { id: 'processing-file' });
        throw error;
      }
    }

    // 如果都没有，返回原对象
    return fileInfo;
  };

  // 流式处理大文件（避免内存溢出）
  const processLargeFileInChunks = (file, fileInfo) => {
    return new Promise((resolve, reject) => {
      const chunkSize = 5 * 1024 * 1024; // 5MB chunks
      const chunks = Math.ceil(file.size / chunkSize);
      let currentChunk = 0;
      const base64Chunks = [];

      // 显示处理进度
      toast.loading(`正在处理大文件... (0/${chunks})`, { id: 'processing-large-file' });

      const readChunk = () => {
        const start = currentChunk * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            // 移除Base64前缀，只保留数据部分
            const base64Content = e.target.result.split(',')[1];
            base64Chunks[currentChunk] = base64Content;
            currentChunk++;

            // 更新进度
            const progress = Math.round((currentChunk / chunks) * 100);
            toast.loading(`正在处理大文件... (${currentChunk}/${chunks}) ${progress}%`, { id: 'processing-large-file' });

            if (currentChunk < chunks) {
              // 继续读取下一块，让出主线程
              setTimeout(readChunk, 0);
            } else {
              // 所有块读取完成，合并结果
              const completeBase64 = `data:${file.type};base64,${base64Chunks.join('')}`;

              resolve({
                ...fileInfo,
                data: completeBase64,
                base64Data: completeBase64,
                file: null
              });

              toast.success('大文件处理完成', { id: 'processing-large-file' });
            }
          } catch (error) {
            console.error('Error processing chunk:', error);
            reject(error);
          }
        };

        reader.onerror = () => {
          toast.error('文件读取失败', { id: 'processing-large-file' });
          reject(new Error('文件读取失败'));
        };

        reader.readAsDataURL(chunk);
      };

      // 开始读取
      readChunk();
    });
  };

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (type === 'audio' && !file.type.startsWith('audio/')) {
      toast.error('请选择音频文件');
      return;
    }

    if (type === 'image' && !file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    // 检查S3配置
    if (!s3StorageService.isConfigured()) {
      toast.error('请先在设置中配置S3存储');
      return;
    }

    // 创建对象URL用于预览
    const url = URL.createObjectURL(file);
    addUrlToCleanup(url);

    // 存储文件信息，稍后会自动上传到S3
    const fileInfo = {
      file: file,
      name: file.name,
      size: file.size,
      type: file.type,
      isLocal: true,
      lastModified: file.lastModified
    };

    setFormData(prev => ({
      ...prev,
      [type === 'audio' ? 'musicUrl' : 'coverUrl']: url,
      [type === 'audio' ? 'audioFile' : 'imageFile']: fileInfo
    }));

    // 显示文件选择提示
    const fileSizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    toast.success(`文件已选择 (${fileSizeInMB}MB)，保存时将自动上传到S3`);
  };


  // 从Base64数据重新创建Blob和URL（优化大文件处理）
  const createBlobFromBase64 = (base64Data, mimeType) => {
    try {
      // 检查输入数据
      if (!base64Data || typeof base64Data !== 'string') {
        console.error('Invalid base64 data:', base64Data);
        return Promise.reject(new Error('Invalid base64 data'));
      }

      // 移除Base64前缀（如果有）
      const base64Content = base64Data.split(',')[1] || base64Data;

      // 对于大文件，使用流式处理
      if (base64Content.length > 50 * 1024 * 1024) { // 50MB以上使用流式处理
        return createBlobFromBase64InChunks(base64Content, mimeType);
      }

      // 中小文件使用标准处理
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const byteCharacters = atob(base64Content);
            const byteNumbers = new Array(byteCharacters.length);

            // 使用分块处理避免阻塞主线程
            const chunkSize = 65536; // 64KB chunks
            let processed = 0;

            const processChunk = () => {
              const start = processed;
              const end = Math.min(start + chunkSize, byteCharacters.length);

              for (let i = start; i < end; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }

              processed = end;

              if (processed < byteCharacters.length) {
                // 继续处理下一块，让出主线程
                setTimeout(processChunk, 0);
              } else {
                // 处理完成
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: mimeType });
                const url = URL.createObjectURL(blob);
                addUrlToCleanup(url);
                resolve(url);
              }
            };

            // 开始处理
            processChunk();
          } catch (error) {
            console.error('Failed to process base64:', error);
            reject(error);
          }
        }, 0);
      });
    } catch (error) {
      console.error('Failed to create blob from base64:', error);
      return Promise.reject(error);
    }
  };

  // 流式处理大Base64数据（避免内存溢出）
  const createBlobFromBase64InChunks = (base64Content, mimeType) => {
    return new Promise((resolve, reject) => {
      const chunkSize = 65536; // 64KB chunks
      const totalLength = base64Content.length;
      let processed = 0;

      // 显示处理进度
      toast.loading('正在恢复大文件...', { id: 'restoring-large-file' });

      const processChunk = () => {
        try {
          const start = processed;
          const end = Math.min(start + chunkSize, totalLength);
          const chunk = base64Content.slice(start, end);

          // 解码当前块
          const byteCharacters = atob(chunk);
          const byteNumbers = new Array(byteCharacters.length);

          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }

          // 创建当前块的Blob
          const chunkBlob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });

          processed = end;

          // 更新进度
          const progress = Math.round((processed / totalLength) * 100);
          toast.loading(`正在恢复大文件... ${progress}%`, { id: 'restoring-large-file' });

          if (processed < totalLength) {
            // 继续处理下一块，让出主线程
            setTimeout(processChunk, 0);
          } else {
            // 处理完成
            const url = URL.createObjectURL(chunkBlob);
            addUrlToCleanup(url);
            toast.success('大文件恢复完成', { id: 'restoring-large-file' });
            resolve(url);
          }
        } catch (error) {
          console.error('Error processing base64 chunk:', error);
          toast.error('大文件恢复失败', { id: 'restoring-large-file' });
          reject(error);
        }
      };

      // 开始处理
      processChunk();
    });
  };

  // 重新生成本地文件的URL（仅支持S3文件）
  const regenerateLocalUrls = async (songs) => {
    const processedSongs = await Promise.all(songs.map(async (song) => {
      const updatedSong = { ...song };

      // 处理音频文件
      if (song.audioFile && song.audioFile.storageType === 's3') {
        try {
          if (song.audioFile.url) {
            // S3文件直接使用URL
            updatedSong.musicUrl = song.audioFile.url;
          }
        } catch (error) {
          console.error('Error regenerating audio URL for:', song.title, error);
          updatedSong.musicUrl = '';
        }
      }

      // 处理图片文件
      if (song.imageFile && song.imageFile.storageType === 's3') {
        try {
          if (song.imageFile.url) {
            // S3文件直接使用URL
            updatedSong.coverUrl = song.imageFile.url;
          }
        } catch (error) {
          console.error('Error regenerating image URL for:', song.title, error);
          updatedSong.coverUrl = '/images/default-music-cover.svg';
        }
      }

      return updatedSong;
    }));

    return processedSongs;
  };

  const resetForm = () => {
    setFormData({
      title: '',
      artist: '',
      musicUrl: '',
      coverUrl: '',
      lyrics: '',
      audioFile: null,
      imageFile: null
    });
    setEditingSong(null);
  };


  return (
    <div className="space-y-4">
      {/* 音乐列表容器 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">音乐列表</Label>
          <Dialog open={isAddDialogOpen || !!editingSong} onOpenChange={(open) => {
            if (!open) {
              setIsAddDialogOpen(false);
              setEditingSong(null);
              resetForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                添加歌曲
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 shadow-xl">
              <DialogHeader>
                <DialogTitle>{editingSong ? '编辑歌曲' : '添加歌曲'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* 歌曲名称 */}
                <div className="space-y-2">
                  <Label htmlFor="title">歌曲名称 *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="输入歌曲名称"
                  />
                </div>

                {/* 歌手名称 */}
                <div className="space-y-2">
                  <Label htmlFor="artist">歌手名称</Label>
                  <Input
                    id="artist"
                    value={formData.artist}
                    onChange={(e) => setFormData(prev => ({ ...prev, artist: e.target.value }))}
                    placeholder="输入歌手名称"
                  />
                </div>

                {/* 歌曲URL */}
                <div className="space-y-2">
                  <Label htmlFor="musicUrl">歌曲URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="musicUrl"
                      value={formData.musicUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, musicUrl: e.target.value }))}
                      placeholder="输入歌曲URL或选择本地文件"
                      className="flex-1"
                    />
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => handleFileUpload(e, 'audio')}
                      className="hidden"
                      id="audio-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('audio-upload').click()}
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* 封面URL */}
                <div className="space-y-2">
                  <Label htmlFor="coverUrl">封面URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="coverUrl"
                      value={formData.coverUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, coverUrl: e.target.value }))}
                      placeholder="输入封面URL或选择本地文件"
                      className="flex-1"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileUpload(e, 'image')}
                      className="hidden"
                      id="cover-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('cover-upload').click()}
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* 歌词内容 */}
                <div className="space-y-2">
                  <Label htmlFor="lyrics">歌词内容</Label>
                  <Textarea
                    id="lyrics"
                    value={formData.lyrics}
                    onChange={(e) => setFormData(prev => ({ ...prev, lyrics: e.target.value }))}
                    placeholder="输入歌词内容（每行一句歌词）"
                    rows={6}
                  />
                  <p className="text-xs text-gray-500">
                    提示：直接输入歌词文本，每行一句歌词。系统会自动处理时间轴。<br />
                    📁 音频文件将自动上传到S3存储，支持无损音乐格式。
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddDialogOpen(false);
                      setEditingSong(null);
                      resetForm();
                    }}
                    className="flex-1"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={editingSong ? handleUpdateSong : handleAddSong}
                    className="flex-1"
                  >
                    {editingSong ? '更新' : '添加'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 音乐列表 */}
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p>正在加载音乐列表...</p>
          </div>
        ) : musicList.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Music className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无音乐，点击上方按钮添加歌曲</p>
          </div>
        ) : (
          musicList.map((song) => (
            <Card key={song.id} className="p-3">
              <div className="flex items-center gap-3">
                <img
                  src={song.coverUrl || '/images/default-music-cover.svg'}
                  alt={song.title}
                  className="w-12 h-12 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{song.title}</div>
                  <div className="text-xs text-gray-500 truncate">{song.artist}</div>
                </div>
                {!song.isBuiltin && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditSong(song)}
                      className="h-8 w-8 p-0"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteSong(song)}
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* 统计信息 */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        共 {musicList.length} 首歌曲（{musicList.filter(s => s.isBuiltin).length} 首内置，{musicList.filter(s => !s.isBuiltin).length} 首自定义）
        {s3StorageService.isConfigured() && (
          <span className="ml-2">
            • S3存储: 已启用
          </span>
        )}
      </div>
    </div>
  );
}