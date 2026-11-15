import { Metadata } from 'next';
import { DashboardGrid } from './components/DashboardGrid';
import { MasterHeader } from './components/ui/MasterHeader';
import { SpeedRecommendationMeter } from './components/ui/SpeedRecommendationMeter';
import { SupportDonateFooter } from './components/ui/SupportDonate';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function Dashboard() {
  const tools = [
    { num: '02', name: 'Video Muter', desc: 'Instantly strip audio tracks or replace with silent audio channels.', path: '/tools/muter' },
    { num: '03', name: 'Universal Compressor', desc: 'Hardware-accelerated video, audio, and image batch compressor with smart CRF estimation.', path: '/tools/hevc' },
    { num: '04', name: 'Universal Converter', desc: 'Universal video, audio, and photo converter with smart stream remuxing & A2V studio.', path: '/tools/converter' },
    { num: '05', name: 'YouTube Downloader', desc: 'High-speed YouTube & Instagram video/audio extractor supporting Reels, 1080p, 320kbps audio, and playlists.', path: '/tools/youtube' },
    { num: '06', name: 'Audio Trimmer', desc: 'Precision waveform audio trimmer with sub-second cue points and multi-track concatenation.', path: '/tools/trimmer' },
    { num: '07', name: 'Spotify Converter', desc: 'Extract high-bitrate audio from Spotify playlists, albums, and single tracks.', path: '/tools/spotify' }
  ];

  return (
    <>
      <MasterHeader
        onlyUtilityBar
        toolName="SYSTEM DASHBOARD"
        engineLabel="SYSTEM"
        engineId="READY"
        hwAccelText="STATUS: ONLINE ●"
      />

      <div className="workspace overflow-y-auto w-full" data-lenis-prevent>
        <div className="w-full">
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 01"
            title={<>System<br/>Overview.</>}
          />
          
          <SpeedRecommendationMeter />
          <DashboardGrid tools={tools} />
          <SupportDonateFooter />
        </div>
      </div>
    </>
  );
}
