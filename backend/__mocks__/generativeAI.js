module.exports = {
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn()
    }))
  })),
  SchemaType: {
    OBJECT: 'object',
    STRING: 'string',
    ARRAY: 'array'
  }
};
