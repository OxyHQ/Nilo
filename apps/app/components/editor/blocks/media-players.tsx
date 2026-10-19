/**
 * Native players for video and audio blocks: `expo-video` and `expo-audio`,
 * which play on iOS, Android and the web alike (no web view). An attachment
 * plays from a URL minted for this reader (`useMediaFileUrl`), swapped for a
 * newer one only while it is not playing (`useMediaSource`).
 */
import { useEvent } from 'expo';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer } from 'expo-video';
import { View } from 'react-native';
import { PlaybackProgress, PlayButton } from '@oxy.so/bloom/media-controls';
import { Text } from '@oxy.so/bloom/typography';
import { VideoView } from '@oxy.so/bloom/video-view';
import { useTranslation } from '@/hooks/useTranslation';
import { useMediaSource } from '@/lib/files/media-source';

export function VideoPlayer({ url, label }: { url: string | null; label: string }) {
  const player = useVideoPlayer(null);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useMediaSource(url, isPlaying, (next, first) => {
    const at = player.currentTime;
    void player.replaceAsync(next).then(() => {
      if (!first && at > 0) player.currentTime = at;
    });
  });
  return (
    <View className="w-full overflow-hidden rounded-lg bg-muted/40" style={{ aspectRatio: 16 / 9 }}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        accessibilityLabel={label}
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

export function AudioPlayer({ url, title }: { url: string | null; title: string }) {
  const { t } = useTranslation();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  useMediaSource(url, status.playing, (next, first) => {
    const at = player.currentTime;
    player.replace(next);
    if (!first && at > 0) void player.seekTo(at);
  });
  const ended =
    status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration);
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (ended) void player.seekTo(0);
    player.play();
  };
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <PlayButton
        size="sm"
        playing={status.playing}
        loading={url !== null && !status.isLoaded}
        disabled={url === null}
        onPress={toggle}
        subject={title}
        playLabel={t('editor.blocks.audio.play')}
        pauseLabel={t('editor.blocks.audio.pause')}
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <PlaybackProgress
          value={status.currentTime}
          duration={status.duration}
          onSeek={(seconds) => void player.seekTo(seconds)}
          showTimes
          disabled={!status.isLoaded}
          accessibilityLabel={t('editor.blocks.audio.seek')}
        />
      </View>
    </View>
  );
}
