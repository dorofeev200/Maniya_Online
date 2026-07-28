import { Provider } from '../base.js';

export class RezkaProvider extends Provider {
  static id = 'rezka';
  static title = 'Rezka';

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

export default RezkaProvider;
