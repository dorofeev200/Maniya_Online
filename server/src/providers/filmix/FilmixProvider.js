import { Provider } from '../base.js';

export class FilmixProvider extends Provider {
  static id = 'filmix';
  static title = 'Filmix';

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

export default FilmixProvider;
