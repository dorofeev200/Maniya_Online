import { Provider } from '../base.js';

export class KodikProvider extends Provider {
  static id = 'kodik';
  static title = 'Kodik';

  constructor(options = {}) {
    super(options);
  }

  name() {
    return this.id;
  }

  enabled() {
    return false;
  }

  async search() {
    return [];
  }

  async movie() {
    return [];
  }

  async serial() {
    return [];
  }

  async streams() {
    return [];
  }
}

export default KodikProvider;
