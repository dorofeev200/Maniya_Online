const Provider = require('../base');
const store = require('../../store');

class TestProvider extends Provider {
  streams(context) {
    return store.streams(context);
  }
}

module.exports = TestProvider;
