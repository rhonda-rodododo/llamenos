import { describe, expect, test } from 'bun:test'
import { opaqueClient, opaqueServer } from './opaque-client'

describe('opaque-client wrapper', () => {
  test('full registration → login round trip produces matching session keys', async () => {
    const password = 'correct horse battery staple'
    const credentialIdentifier = '11111111-2222-4333-8444-555555555555:root-kek'

    const serverSetup = await opaqueServer.createSetup()

    const regStart = await opaqueClient.registrationStart(password)
    const regResponse = await opaqueServer.createRegistrationResponse({
      setupBase64: serverSetup,
      registrationRequestBase64: regStart.message,
      credentialIdentifier,
    })
    const regFinish = await opaqueClient.registrationFinish({
      stateBase64: regStart.state,
      password,
      registrationResponseBase64: regResponse,
    })
    expect(regFinish.exportKey).toBeInstanceOf(Uint8Array)
    expect(regFinish.exportKey.length).toBe(64)
    expect(regFinish.serverStaticPk.length).toBeGreaterThan(0)

    const passwordFile = await opaqueServer.finishRegistration({
      uploadBase64: regFinish.message,
    })

    const loginStart = await opaqueClient.loginStart(password)
    const serverLoginStart = await opaqueServer.startLogin({
      setupBase64: serverSetup,
      passwordFileBase64: passwordFile,
      credentialRequestBase64: loginStart.message,
      credentialIdentifier,
    })
    const loginFinish = await opaqueClient.loginFinish({
      stateBase64: loginStart.state,
      password,
      credentialResponseBase64: serverLoginStart.message,
    })
    const serverLoginFinish = await opaqueServer.finishLogin({
      stateBase64: serverLoginStart.state,
      credentialFinalizationBase64: loginFinish.message,
    })

    expect(loginFinish.sessionKey).toEqual(serverLoginFinish.sessionKey)
    expect(loginFinish.exportKey).toEqual(regFinish.exportKey)
    expect(loginFinish.serverStaticPk).toEqual(regFinish.serverStaticPk)
  }, 30_000)

  test('login with wrong password throws', async () => {
    const credentialIdentifier = '22222222-3333-4444-8555-666666666666:root-kek'
    const serverSetup = await opaqueServer.createSetup()

    const regStart = await opaqueClient.registrationStart('rightpw')
    const regResponse = await opaqueServer.createRegistrationResponse({
      setupBase64: serverSetup,
      registrationRequestBase64: regStart.message,
      credentialIdentifier,
    })
    const regFinish = await opaqueClient.registrationFinish({
      stateBase64: regStart.state,
      password: 'rightpw',
      registrationResponseBase64: regResponse,
    })
    const passwordFile = await opaqueServer.finishRegistration({
      uploadBase64: regFinish.message,
    })

    const loginStart = await opaqueClient.loginStart('wrongpw')
    const serverLoginStart = await opaqueServer.startLogin({
      setupBase64: serverSetup,
      passwordFileBase64: passwordFile,
      credentialRequestBase64: loginStart.message,
      credentialIdentifier,
    })
    await expect(
      opaqueClient.loginFinish({
        stateBase64: loginStart.state,
        password: 'wrongpw',
        credentialResponseBase64: serverLoginStart.message,
      })
    ).rejects.toThrow()
  }, 30_000)

  test('export key is stable across multiple logins', async () => {
    const credentialIdentifier = '33333333-4444-5555-8666-777777777777:root-kek'
    const serverSetup = await opaqueServer.createSetup()
    const password = 'stable-export-key-test'

    // Registration
    const regStart = await opaqueClient.registrationStart(password)
    const regResponse = await opaqueServer.createRegistrationResponse({
      setupBase64: serverSetup,
      registrationRequestBase64: regStart.message,
      credentialIdentifier,
    })
    const regFinish = await opaqueClient.registrationFinish({
      stateBase64: regStart.state,
      password,
      registrationResponseBase64: regResponse,
    })
    const passwordFile = await opaqueServer.finishRegistration({
      uploadBase64: regFinish.message,
    })

    // Login 1
    const login1 = await opaqueClient.loginStart(password)
    const server1 = await opaqueServer.startLogin({
      setupBase64: serverSetup,
      passwordFileBase64: passwordFile,
      credentialRequestBase64: login1.message,
      credentialIdentifier,
    })
    const finish1 = await opaqueClient.loginFinish({
      stateBase64: login1.state,
      password,
      credentialResponseBase64: server1.message,
    })

    // Login 2
    const login2 = await opaqueClient.loginStart(password)
    const server2 = await opaqueServer.startLogin({
      setupBase64: serverSetup,
      passwordFileBase64: passwordFile,
      credentialRequestBase64: login2.message,
      credentialIdentifier,
    })
    const finish2 = await opaqueClient.loginFinish({
      stateBase64: login2.state,
      password,
      credentialResponseBase64: server2.message,
    })

    // Export key is stable (same password → same export key)
    expect(finish1.exportKey).toEqual(regFinish.exportKey)
    expect(finish2.exportKey).toEqual(regFinish.exportKey)
    // Session keys are ephemeral (different each login)
    expect(finish1.sessionKey).not.toEqual(finish2.sessionKey)
  }, 30_000)
})
