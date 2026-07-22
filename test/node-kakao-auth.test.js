'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'node_modules/node-kakao/dist/api/auth-api-client.js');
const axiosClientPath = path.join(root, 'node_modules/node-kakao/dist/api/axios-web-client.js');

const defaultConfiguration = {
    agent: 'android',
    version: '25.8.1',
    osVersion: '7.1.2',
    language: 'ko',
    countryIso: 'KR',
    deviceModel: 'SM-T870',
};

const defaultProvider = {
    async toFullXVCKey() {
        return 'a'.repeat(128);
    },
};

const loadState = {
    createdWebClient: null,
};

class DataWebRequestStub {
    constructor(client) {
        this.client = client;
    }

    requestData(method, requestPath, body, headers) {
        return this.client.requestData(method, requestPath, body, headers);
    }
}

function loadAuthModule() {
    delete require.cache[authPath];
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
        if (parent && parent.filename === authPath) {
            if (request === './web-client') {
                return {
                    DataWebRequest: DataWebRequestStub,
                    createWebClient: async () => loadState.createdWebClient,
                };
            }
            if (request === '../config') return { DefaultConfiguration: defaultConfiguration };
            if (request === '../request') return { KnownDataStatusCode: { SUCCESS: 0 } };
            if (request === './header-util') {
                return {
                    fillBaseHeader: (header, config) => { header['Accept-Language'] = config.language; },
                    fillAHeader: (header, config) => { header.A = `${config.agent}/${config.version}/${config.language}`; },
                    getUserAgent: (config) => `KT/${config.version} An/${config.osVersion} ${config.language}`,
                };
            }
            if (request === './struct') return { structToLoginData: (value) => value };
            if (request === './xvc') return { AndroidSubXVCProvider: defaultProvider };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(authPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

class FakeDataClient {
    constructor(responses) {
        this.responses = [...responses];
        this.calls = [];
    }

    async requestData(method, requestPath, body, headers) {
        this.calls.push({ method, path: requestPath, body, headers });
        if (this.responses.length === 0) throw new Error('Unexpected request');
        return this.responses.shift();
    }
}

test('AuthApiClient.create accepts the declared four-argument signature', async () => {
    const { AuthApiClient } = loadAuthModule();
    loadState.createdWebClient = new FakeDataClient([]);
    const provider = { async toFullXVCKey() { return 'b'.repeat(128); } };

    const client = await AuthApiClient.create(
        'TCGenius',
        'device-uuid',
        { language: 'en', countryIso: 'US' },
        provider,
    );

    assert.equal(client.config.language, 'en');
    assert.equal(client.config.countryIso, 'US');
    assert.equal(client.xvcProvider, provider);
    assert.equal(typeof client.advertisementId, 'string');
    assert.notEqual(client.advertisementId, '[object Object]');
});

test('login preserves forced and sends device_name separately from model_name', async () => {
    const { AuthApiClient } = loadAuthModule();
    const fake = new FakeDataClient([{ status: 12 }]);
    const client = new AuthApiClient(fake, 'TCGenius', 'device-uuid', 'ad-id', defaultConfiguration, defaultProvider);

    const result = await client.login({ email: 'user@example.com', password: 'pw', forced: true });

    assert.equal(result.success, false);
    assert.equal(fake.calls[0].path, 'android/account/login.json');
    assert.equal(fake.calls[0].body.forced, true);
    assert.equal(fake.calls[0].body.device_name, 'TCGenius');
    assert.equal(fake.calls[0].body.model_name, 'SM-T870');
    assert.equal(fake.calls[0].headers.Adid, 'ad-id');
});

test('generatePasscode uses the passcodeLogin JSON contract', async () => {
    const { AuthApiClient } = loadAuthModule();
    const fake = new FakeDataClient([{ status: 0, passcode: '12345678', remainingSeconds: 60 }]);
    const client = new AuthApiClient(fake, 'TCGenius', 'device-uuid', 'ad-id', defaultConfiguration, defaultProvider);

    const result = await client.generatePasscode(
        { email: 'user@example.com', password: 'pw' },
        { deviceOsApiLevel: '35' },
    );

    assert.deepEqual(result, {
        status: 0,
        success: true,
        result: { passcode: '12345678', remainingSeconds: 60 },
    });
    assert.equal(fake.calls[0].path, 'android/account/passcodeLogin/generate');
    assert.equal(fake.calls[0].headers['Content-Type'], 'application/json; charset=utf-8');
    assert.deepEqual(fake.calls[0].body, {
        email: 'user@example.com',
        password: 'pw',
        permanent: true,
        device: {
            name: 'TCGenius',
            uuid: 'device-uuid',
            model: 'SM-T870',
            osVersion: '35',
            isOneStore: false,
        },
    });
});

test('requestPasscode exposes the generated challenge through a callback', async () => {
    const { AuthApiClient } = loadAuthModule();
    const fake = new FakeDataClient([{ status: 0, passcode: '87654321', remainingSeconds: 90 }]);
    const client = new AuthApiClient(fake, 'TCGenius', 'device-uuid', 'ad-id', defaultConfiguration, defaultProvider);
    let challenge;

    const result = await client.requestPasscode(
        { email: 'user@example.com', password: 'pw' },
        { onPasscodeRequired: (value) => { challenge = value; } },
    );

    assert.equal(result.success, true);
    assert.deepEqual(challenge, { passcode: '87654321', remainingSeconds: 90 });
});

test('registerDevice polls registerDevice until official-app approval is observed', async () => {
    const { AuthApiClient } = loadAuthModule();
    const fake = new FakeDataClient([
        { status: -100, nextRequestIntervalInSeconds: 0, remainingSeconds: 60 },
        { status: 0 },
    ]);
    const client = new AuthApiClient(fake, 'TCGenius', 'device-uuid', 'ad-id', defaultConfiguration, defaultProvider);

    const result = await client.registerDevice(
        { email: 'user@example.com', password: 'pw' },
        'legacy-passcode-argument',
        true,
        { timeoutSeconds: 5 },
    );

    assert.deepEqual(result, { status: 0, success: true });
    assert.deepEqual(fake.calls.map((call) => call.path), [
        'android/account/passcodeLogin/registerDevice',
        'android/account/passcodeLogin/registerDevice',
    ]);
    assert.deepEqual(fake.calls[0].body, {
        email: 'user@example.com',
        password: 'pw',
        device: { uuid: 'device-uuid' },
    });
});

test('AxiosWebClient serializes application/json request bodies as JSON', async () => {
    delete require.cache[axiosClientPath];
    let capturedRequest;
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
        if (parent && parent.filename === axiosClientPath) {
            if (request === 'axios') {
                return {
                    __esModule: true,
                    default: {
                        request: async (value) => {
                            capturedRequest = value;
                            return { status: 200, statusText: 'OK', data: new ArrayBuffer(0) };
                        },
                    },
                };
            }
            if (request === './web-api-util') {
                return { convertToFormData: () => { throw new Error('form encoder must not be used'); } };
            }
            if (request === 'form-data') {
                return { __esModule: true, default: class FormDataStub {} };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const { AxiosWebClient } = require(axiosClientPath);
        const client = new AxiosWebClient('https', 'katalk.kakao.com');
        const body = { device: { uuid: 'device-uuid' } };
        await client.request('POST', 'android/account/passcodeLogin/registerDevice', body, {
            'Content-Type': 'application/json; charset=utf-8',
        });
        assert.equal(capturedRequest.data, JSON.stringify(body));
    }
    finally {
        Module._load = originalLoad;
    }
});

test('default auth profile is the live-validated Android 25.8.1 profile', () => {
    const { DefaultConfiguration } = require('../node_modules/node-kakao/dist/config.js');
    assert.equal(DefaultConfiguration.version, '25.8.1');
    assert.equal(DefaultConfiguration.osVersion, '7.1.2');
    assert.equal(DefaultConfiguration.deviceModel, 'SM-T870');
});
