import { Provider } from '../base.js';

const TEST_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export class TestProvider extends Provider {
  static id = 'test';
  static title = 'Test Provider';

  enabled() {
    return true;
  }

  async streams() {
    return [
      this.streamItem({
        id: 'test-stream-1080p',
        title: 'Тестовый поток 1080p',
        type: 'hls',
        quality: '1080p',
        voice: 'original',
        stream: {
          url: TEST_STREAM_URL,
          headers: {}
        },
        subtitles: []
      })
    ];
  }
}

export default TestProvider;
