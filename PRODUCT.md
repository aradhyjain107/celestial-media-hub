# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Content creators, video/audio editors, podcast producers, and software engineers executing heavy, privacy-sensitive media transformation workflows locally on their own machines. They require high-throughput batch operations without arbitrary file size or count caps, slow cloud upload bottlenecks, or telemetry exposure.

## Product Purpose
Celestial Media Hub transforms local consumer and workstation hardware into an unconstrained, studio-grade media processing engine. It unifies high-performance transcoding, smart lossless remuxing, procedural audio-to-video kinetic synthesis, interactive dual-track waveform editing, stream extraction, and device-calibrated batch compression into a fluid, zero-configuration local web interface.

## Positioning
Unlike cloud converters that throttle file sizes, queue jobs behind subscription paywalls, and leak media to remote servers, Celestial Media Hub directly calibrates to host hardware (Apple Silicon P/E-core topologies, VideoToolbox/NVENC accelerators, unified RAM headroom). It executes zero-RAM sliced stream piping, sub-second PTS-synchronized audio-to-video synthesis, and lossless codec passthrough at the maximum speed of the physical machine.

## Operating Context
- **Execution Model**: Runs locally on macOS / Linux / Windows workstations via Node.js / Next.js with native system tool bindings (`ffmpeg`, `ffprobe`, `yt-dlp`, `cwebp`, `sips`).
- **Input Workflows**: Multi-gigabyte raw camera footage (`.mov`, `.mp4`, `.mkv`, `.cr2`), multi-track lossy/lossless audio stems (`.flac`, `.wav`, `.mp3`, `.m4a`), Spotify albums/playlists, and remote video/stream URLs.
- **Output Workflows**: QuickTime / Apple AVFoundation-healed outputs (`-tag:v hvc1`, `-movflags +faststart`), production web bundles (`.webp`, `.avif`, `.mp4`), compressed archives, and social video clips.

## Capabilities and Constraints
- **Universal Format Matrix & Smart Remux**: Dynamic container conversion with ffprobe stream inspection; automatically copies compatible audio/video streams without re-encoding to avoid quality loss and save compute cycles.
- **Audio-to-Video Synthesis Studio**: Real-time dual-track trimmer with audio RMS waveform decimation, companion video attachment, 4 kinetic visualizer styles (Obsidian Pulse, Cyber Bars, Nebula Spectrum, Minimal Wave), and zero-drift PTS normalization.
- **Hardware-Calibrated Batch Engine**: Dynamically scales upload thresholds based on host specs and media weights ($10\times$ for images up to 5,000+ files, $4\times$ for audio, $2\times$ for lossless remux, $1\times$ for HEVC transcode).
- **Universal Compressor**: Multi-codec (HEVC, H.264, AV1, VP9) CRF reduction with auto-detected hardware acceleration (VideoToolbox / NVENC) and real-time space savings estimations.
- **Interactive Audio Trimmer**: Canvas-rendered Web Audio waveform with sub-second cue points, logarithmic volume normalization, fade curves, and multi-file concat demuxing.
- **Remote Extractors**: YouTube video/playlist stream ripping and Spotify metadata resolution to high-bitrate audio with SSE progress streaming and single-track failure recovery.
- **Security & Integrity Boundaries**: HS256 JWT authorization, per-job resource ownership (BOLA/IDOR protection), SSRF URL protocol guards, 16MB sliced write barriers (>2GB payload protection), and background TTL temp folder pruning.

## Brand Commitments
- **Name**: Celestial Media Hub
- **Visual Feel**: Kinetic & Creative — Obsidian Cyber-Noir studio feel with fluid transitions, animated waveforms, Cyber Orange (`#FF5A00`) and Void (`#030304`) palette, and high-precision visual feedback.
- **Tone**: Powerful, immediate, transparent, professional-grade, and privacy-respecting.

## Evidence on Hand
- **Test Suite**: 52 test suites / 610 automated tests passing with 100% test coverage across security, unit, adversarial, and stress tests.
- **Live Local Server**: Active Next.js 14 runtime at `http://localhost:3000` with live health monitoring (`/api/health`) and telemetry (`/api/system/hardware`).

## Product Principles
1. **Unconstrained Physical Performance**: Never impose arbitrary software caps on local hardware; calibrate dynamically to the host machine's physical limits.
2. **Zero Quality Loss Default**: Always prefer lossless stream remuxing and codec copy over unnecessary re-encoding.
3. **Immediate Real-Time Feedback**: Keep users informed at all times through real-time Server-Sent Events, fluid progress meters, and dynamic resource badges.
4. **Local Privacy by Design**: All transformations and media stay strictly on the local machine; zero external telemetry or cloud leakage.
5. **Fail-Safe Self-Healing**: Detect incompatible codec/container combinations (e.g. QuickTime AC3, WAV in M4A) and auto-heal them transparently.

## Accessibility & Inclusion
- Full keyboard navigation and timecode nudge controls (`0.1s` / `1.0s`) on trimmers and timelines.
- High-contrast visual cues, accessible form labels, semantic ARIA roles, and motion-reduction awareness.
