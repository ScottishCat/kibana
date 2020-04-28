/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { Type } from '@kbn/config-schema';
import {
  IRouter,
  kibanaResponseFactory,
  RequestHandler,
  RequestHandlerContext,
  RouteConfig,
} from '../../../../../../src/core/server';
import { SecurityLicense, SecurityLicenseFeatures } from '../../../common/licensing';
import {
  Authentication,
  AuthenticationResult,
  DeauthenticationResult,
  OIDCLogin,
  SAMLLogin,
} from '../../authentication';
import { defineCommonRoutes } from './common';

import { httpServerMock } from '../../../../../../src/core/server/mocks';
import { mockAuthenticatedUser } from '../../../common/model/authenticated_user.mock';
import { routeDefinitionParamsMock } from '../index.mock';

describe('Common authentication routes', () => {
  let router: jest.Mocked<IRouter>;
  let authc: jest.Mocked<Authentication>;
  let license: jest.Mocked<SecurityLicense>;
  let mockContext: RequestHandlerContext;
  beforeEach(() => {
    const routeParamsMock = routeDefinitionParamsMock.create();
    router = routeParamsMock.router;
    authc = routeParamsMock.authc;
    license = routeParamsMock.license;

    mockContext = ({
      licensing: {
        license: { check: jest.fn().mockReturnValue({ check: 'valid' }) },
      },
    } as unknown) as RequestHandlerContext;

    defineCommonRoutes(routeParamsMock);
  });

  describe('logout', () => {
    let routeHandler: RequestHandler<any, any, any>;
    let routeConfig: RouteConfig<any, any, any, any>;

    const mockRequest = httpServerMock.createKibanaRequest({
      body: { username: 'user', password: 'password' },
    });

    beforeEach(() => {
      const [loginRouteConfig, loginRouteHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/logout'
      )!;

      routeConfig = loginRouteConfig;
      routeHandler = loginRouteHandler;
    });

    it('correctly defines route.', async () => {
      expect(routeConfig.options).toEqual({ authRequired: false });
      expect(routeConfig.validate).toEqual({
        body: undefined,
        query: expect.any(Type),
        params: undefined,
      });

      const queryValidator = (routeConfig.validate as any).query as Type<any>;
      expect(queryValidator.validate({ someRandomField: 'some-random' })).toEqual({
        someRandomField: 'some-random',
      });
      expect(queryValidator.validate({})).toEqual({});
      expect(queryValidator.validate(undefined)).toEqual({});
    });

    it('returns 500 if deauthentication throws unhandled exception.', async () => {
      const unhandledException = new Error('Something went wrong.');
      authc.logout.mockRejectedValue(unhandledException);

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(500);
      expect(response.payload).toEqual(unhandledException);
      expect(authc.logout).toHaveBeenCalledWith(mockRequest);
    });

    it('returns 500 if authenticator fails to logout.', async () => {
      const failureReason = new Error('Something went wrong.');
      authc.logout.mockResolvedValue(DeauthenticationResult.failed(failureReason));

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(500);
      expect(response.payload).toEqual(failureReason);
      expect(authc.logout).toHaveBeenCalledWith(mockRequest);
    });

    it('returns 400 for AJAX requests that can not handle redirect.', async () => {
      const mockAjaxRequest = httpServerMock.createKibanaRequest({
        headers: { 'kbn-xsrf': 'xsrf' },
      });

      const response = await routeHandler(mockContext, mockAjaxRequest, kibanaResponseFactory);

      expect(response.status).toBe(400);
      expect(response.payload).toEqual('Client should be able to process redirect response.');
      expect(authc.logout).not.toHaveBeenCalled();
    });

    it('redirects user to the URL returned by authenticator.', async () => {
      authc.logout.mockResolvedValue(DeauthenticationResult.redirectTo('https://custom.logout'));

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(302);
      expect(response.payload).toBeUndefined();
      expect(response.options).toEqual({ headers: { location: 'https://custom.logout' } });
      expect(authc.logout).toHaveBeenCalledWith(mockRequest);
    });

    it('redirects user to the base path if deauthentication succeeds.', async () => {
      authc.logout.mockResolvedValue(DeauthenticationResult.succeeded());

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(302);
      expect(response.payload).toBeUndefined();
      expect(response.options).toEqual({ headers: { location: '/mock-server-basepath/' } });
      expect(authc.logout).toHaveBeenCalledWith(mockRequest);
    });

    it('redirects user to the base path if deauthentication is not handled.', async () => {
      authc.logout.mockResolvedValue(DeauthenticationResult.notHandled());

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(302);
      expect(response.payload).toBeUndefined();
      expect(response.options).toEqual({ headers: { location: '/mock-server-basepath/' } });
      expect(authc.logout).toHaveBeenCalledWith(mockRequest);
    });
  });

  describe('me', () => {
    let routeHandler: RequestHandler<any, any, any>;
    let routeConfig: RouteConfig<any, any, any, any>;

    const mockRequest = httpServerMock.createKibanaRequest({
      body: { username: 'user', password: 'password' },
    });

    beforeEach(() => {
      const [loginRouteConfig, loginRouteHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/internal/security/me'
      )!;

      routeConfig = loginRouteConfig;
      routeHandler = loginRouteHandler;
    });

    it('correctly defines route.', async () => {
      expect(routeConfig.options).toBeUndefined();
      expect(routeConfig.validate).toBe(false);
    });

    it('returns current user.', async () => {
      const mockUser = mockAuthenticatedUser();
      authc.getCurrentUser.mockReturnValue(mockUser);

      const response = await routeHandler(mockContext, mockRequest, kibanaResponseFactory);

      expect(response.status).toBe(200);
      expect(response.payload).toEqual(mockUser);
      expect(authc.getCurrentUser).toHaveBeenCalledWith(mockRequest);
    });
  });

  describe('login_with', () => {
    let routeHandler: RequestHandler<any, any, any>;
    let routeConfig: RouteConfig<any, any, any, any>;
    beforeEach(() => {
      const [acsRouteConfig, acsRouteHandler] = router.post.mock.calls.find(
        ([{ path }]) => path === '/internal/security/login_with'
      )!;

      routeConfig = acsRouteConfig;
      routeHandler = acsRouteHandler;
    });

    it('correctly defines route.', () => {
      expect(routeConfig.options).toEqual({ authRequired: false });
      expect(routeConfig.validate).toEqual({
        body: expect.any(Type),
        query: undefined,
        params: undefined,
      });

      const bodyValidator = (routeConfig.validate as any).body as Type<any>;
      expect(
        bodyValidator.validate({
          providerType: 'saml',
          providerName: 'saml1',
          currentURL: '/some-url',
        })
      ).toEqual({
        providerType: 'saml',
        providerName: 'saml1',
        currentURL: '/some-url',
      });

      expect(
        bodyValidator.validate({
          providerType: 'saml',
          providerName: 'saml1',
          currentURL: '',
        })
      ).toEqual({
        providerType: 'saml',
        providerName: 'saml1',
        currentURL: '',
      });

      expect(() => bodyValidator.validate({})).toThrowErrorMatchingInlineSnapshot(
        `"[providerType]: expected value of type [string] but got [undefined]"`
      );

      expect(() =>
        bodyValidator.validate({ providerType: 'saml' })
      ).toThrowErrorMatchingInlineSnapshot(
        `"[providerName]: expected value of type [string] but got [undefined]"`
      );

      expect(() =>
        bodyValidator.validate({ providerType: 'saml', providerName: 'saml1' })
      ).toThrowErrorMatchingInlineSnapshot(
        `"[currentURL]: expected value of type [string] but got [undefined]"`
      );

      expect(() =>
        bodyValidator.validate({
          providerType: 'saml',
          providerName: 'saml1',
          currentURL: '/some-url',
          UnknownArg: 'arg',
        })
      ).toThrowErrorMatchingInlineSnapshot(`"[UnknownArg]: definition for this key is missing"`);
    });

    it('returns 500 if login throws unhandled exception.', async () => {
      const unhandledException = new Error('Something went wrong.');
      authc.login.mockRejectedValue(unhandledException);

      const request = httpServerMock.createKibanaRequest({
        body: { providerType: 'saml', providerName: 'saml1', currentURL: '/some-url' },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 500,
        payload: 'Internal Error',
        options: {},
      });
    });

    it('returns 401 if login fails.', async () => {
      const failureReason = new Error('Something went wrong.');
      authc.login.mockResolvedValue(
        AuthenticationResult.failed(failureReason, {
          authResponseHeaders: { 'WWW-Something': 'something' },
        })
      );

      const request = httpServerMock.createKibanaRequest({
        body: { providerType: 'saml', providerName: 'saml1', currentURL: '/some-url' },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 401,
        payload: failureReason,
        options: { body: failureReason, headers: { 'WWW-Something': 'something' } },
      });
    });

    it('returns 401 if login is not handled.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.notHandled());

      const request = httpServerMock.createKibanaRequest({
        body: { providerType: 'saml', providerName: 'saml1', currentURL: '/some-url' },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 401,
        payload: 'Unauthorized',
        options: {},
      });
    });

    it('returns redirect location from authentication result if any.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.redirectTo('http://redirect-to/path'));

      const request = httpServerMock.createKibanaRequest({
        body: { providerType: 'saml', providerName: 'saml1', currentURL: '/some-url' },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 200,
        payload: { location: 'http://redirect-to/path' },
        options: { body: { location: 'http://redirect-to/path' } },
      });
    });

    it('returns location extracted from `next` parameter if authentication result does not specify any.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.succeeded(mockAuthenticatedUser()));

      const request = httpServerMock.createKibanaRequest({
        body: {
          providerType: 'saml',
          providerName: 'saml1',
          currentURL: 'https://kibana.com/?next=/mock-server-basepath/some-url#/app/nav',
        },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 200,
        payload: { location: '/mock-server-basepath/some-url#/app/nav' },
        options: { body: { location: '/mock-server-basepath/some-url#/app/nav' } },
      });
    });

    it('returns base path if location cannot be extracted from `currentURL` parameter and authentication result does not specify any.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.succeeded(mockAuthenticatedUser()));

      const invalidCurrentURLs = [
        'https://kibana.com/?next=https://evil.com/mock-server-basepath/some-url#/app/nav',
        'https://kibana.com/?next=https://kibana.com:9000/mock-server-basepath/some-url#/app/nav',
        'https://kibana.com/?next=kibana.com/mock-server-basepath/some-url#/app/nav',
        'https://kibana.com/?next=//mock-server-basepath/some-url#/app/nav',
        'https://kibana.com/?next=../mock-server-basepath/some-url#/app/nav',
        'https://kibana.com/?next=/some-url#/app/nav',
        '',
      ];

      for (const currentURL of invalidCurrentURLs) {
        const request = httpServerMock.createKibanaRequest({
          body: { providerType: 'saml', providerName: 'saml1', currentURL },
        });

        await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
          status: 200,
          payload: { location: '/mock-server-basepath/' },
          options: { body: { location: '/mock-server-basepath/' } },
        });
      }
    });

    it('correctly performs SAML login.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.redirectTo('http://redirect-to/path'));

      const request = httpServerMock.createKibanaRequest({
        body: {
          providerType: 'saml',
          providerName: 'saml1',
          currentURL: 'https://kibana.com/?next=/mock-server-basepath/some-url#/app/nav',
        },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 200,
        payload: { location: 'http://redirect-to/path' },
        options: { body: { location: 'http://redirect-to/path' } },
      });

      expect(authc.login).toHaveBeenCalledTimes(1);
      expect(authc.login).toHaveBeenCalledWith(request, {
        provider: { name: 'saml1' },
        value: {
          type: SAMLLogin.LoginInitiatedByUser,
          redirectURLPath: '/mock-server-basepath/some-url',
          redirectURLFragment: '#/app/nav',
        },
      });
    });

    it('correctly performs OIDC login.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.redirectTo('http://redirect-to/path'));

      const request = httpServerMock.createKibanaRequest({
        body: {
          providerType: 'oidc',
          providerName: 'oidc1',
          currentURL: 'https://kibana.com/?next=/mock-server-basepath/some-url#/app/nav',
        },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 200,
        payload: { location: 'http://redirect-to/path' },
        options: { body: { location: 'http://redirect-to/path' } },
      });

      expect(authc.login).toHaveBeenCalledTimes(1);
      expect(authc.login).toHaveBeenCalledWith(request, {
        provider: { name: 'oidc1' },
        value: {
          type: OIDCLogin.LoginInitiatedByUser,
          redirectURLPath: '/mock-server-basepath/some-url',
        },
      });
    });

    it('correctly performs generic login.', async () => {
      authc.login.mockResolvedValue(AuthenticationResult.redirectTo('http://redirect-to/path'));

      const request = httpServerMock.createKibanaRequest({
        body: {
          providerType: 'some-type',
          providerName: 'some-name',
          currentURL: 'https://kibana.com/?next=/mock-server-basepath/some-url#/app/nav',
        },
      });

      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 200,
        payload: { location: 'http://redirect-to/path' },
        options: { body: { location: 'http://redirect-to/path' } },
      });

      expect(authc.login).toHaveBeenCalledTimes(1);
      expect(authc.login).toHaveBeenCalledWith(request, {
        provider: { name: 'some-name' },
      });
    });
  });

  describe('acknowledge access agreement', () => {
    let routeHandler: RequestHandler<any, any, any>;
    let routeConfig: RouteConfig<any, any, any, any>;
    beforeEach(() => {
      const [acsRouteConfig, acsRouteHandler] = router.post.mock.calls.find(
        ([{ path }]) => path === '/internal/security/access_agreement/acknowledge'
      )!;

      license.getFeatures.mockReturnValue({
        allowAccessAgreement: true,
      } as SecurityLicenseFeatures);

      routeConfig = acsRouteConfig;
      routeHandler = acsRouteHandler;
    });

    it('correctly defines route.', () => {
      expect(routeConfig.options).toBeUndefined();
      expect(routeConfig.validate).toBe(false);
    });

    it(`returns 403 if current license doesn't allow access agreement acknowledgement.`, async () => {
      license.getFeatures.mockReturnValue({
        allowAccessAgreement: false,
      } as SecurityLicenseFeatures);

      const request = httpServerMock.createKibanaRequest();
      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 403,
        payload: { message: `Current license doesn't support access agreement.` },
        options: { body: { message: `Current license doesn't support access agreement.` } },
      });
    });

    it('returns 500 if acknowledge throws unhandled exception.', async () => {
      const unhandledException = new Error('Something went wrong.');
      authc.acknowledgeAccessAgreement.mockRejectedValue(unhandledException);

      const request = httpServerMock.createKibanaRequest();
      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 500,
        payload: 'Internal Error',
        options: {},
      });
    });

    it('returns 204 if successfully acknowledged.', async () => {
      authc.acknowledgeAccessAgreement.mockResolvedValue(undefined);

      const request = httpServerMock.createKibanaRequest();
      await expect(routeHandler(mockContext, request, kibanaResponseFactory)).resolves.toEqual({
        status: 204,
        options: {},
      });
    });
  });
});
