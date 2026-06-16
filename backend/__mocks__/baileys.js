module.exports = {
  makeWASocket: jest.fn(() => ({
    ev: { on: jest.fn() },
    sendMessage: jest.fn()
  })),
  useMultiFileAuthState: jest.fn(() => Promise.resolve({
    state: {},
    saveCreds: jest.fn()
  })),
  DisconnectReason: { loggedOut: 1 },
  Browsers: { chrome: () => 'Chrome' },
  downloadMediaMessage: jest.fn()
};
