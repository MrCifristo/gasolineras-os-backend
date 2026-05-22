// Mock for puppeteer — prevents ESM parse errors in Jest E2E tests.
// PDF generation is not exercised in E2E tests.
const puppeteer = {
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('')),
      close: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
};

module.exports = puppeteer;
module.exports.default = puppeteer;
