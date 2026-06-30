'use strict';

// Mock the AI SDK modules that aicoreDeployment dynamically imports.
const mockDeploymentQuery = jest.fn();
const mockExecute = jest.fn();
jest.mock('@sap-ai-sdk/ai-api', () => ({
  DeploymentApi: { deploymentQuery: (...a) => mockDeploymentQuery(...a) }
}));

const mockGetAiCoreDestination = jest.fn();
jest.mock('@sap-ai-sdk/core', () => ({
  getAiCoreDestination: (...a) => mockGetAiCoreDestination(...a)
}));

const { resolveDeployedModel, getAiCoreToken } = require('../srv/code/utils/aicoreDeployment');

beforeEach(() => {
  mockDeploymentQuery.mockReset();
  mockExecute.mockReset();
  mockGetAiCoreDestination.mockReset();
  mockDeploymentQuery.mockReturnValue({ execute: mockExecute });
});

describe('getAiCoreToken', () => {
  test('returns token from authTokens', async () => {
    mockGetAiCoreDestination.mockResolvedValue({ authTokens: [{ value: 'tok-1' }] });
    expect(await getAiCoreToken()).toBe('tok-1');
  });

  test('falls back to Authorization header', async () => {
    mockGetAiCoreDestination.mockResolvedValue({ headers: { Authorization: 'Bearer tok-2' } });
    expect(await getAiCoreToken()).toBe('tok-2');
  });

  test('returns undefined when destination lookup fails', async () => {
    mockGetAiCoreDestination.mockRejectedValue(new Error('no binding'));
    expect(await getAiCoreToken()).toBeUndefined();
  });
});

describe('resolveDeployedModel', () => {
  test('returns endpoint for a matching RUNNING deployment', async () => {
    mockExecute.mockResolvedValue({
      resources: [{ deploymentUrl: 'https://d/gpt', configurationName: 'gpt-oss-120b-cfg' }]
    });
    mockGetAiCoreDestination.mockResolvedValue({ authTokens: [{ value: 'tok' }] });

    const ep = await resolveDeployedModel('gpt-oss-120b');
    expect(ep).toEqual({ baseUrl: 'https://d/gpt', token: 'tok', resourceGroup: 'default' });
    expect(mockDeploymentQuery).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RUNNING' }),
      expect.objectContaining({ 'AI-Resource-Group': 'default' })
    );
  });

  test('returns null when no deployment has a URL', async () => {
    mockExecute.mockResolvedValue({ resources: [] });
    expect(await resolveDeployedModel('gpt-oss-120b')).toBeNull();
  });

  test('returns null when no token can be obtained', async () => {
    mockExecute.mockResolvedValue({ resources: [{ deploymentUrl: 'https://d', configurationName: 'x' }] });
    mockGetAiCoreDestination.mockRejectedValue(new Error('no binding'));
    expect(await resolveDeployedModel('gpt-oss-120b')).toBeNull();
  });

  test('returns null when the deployment query throws', async () => {
    mockExecute.mockRejectedValue(new Error('AI Core unreachable'));
    expect(await resolveDeployedModel('gpt-oss-120b')).toBeNull();
  });
});
