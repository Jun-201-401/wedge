package com.wedge.auth.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.auth.api.dto.AuthTokenResponse;
import com.wedge.auth.api.dto.UserResponse;
import com.wedge.auth.application.AuthService;
import com.wedge.auth.application.AuthTokenIssue;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.core.MethodParameter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthControllerTest {
    private final AuthService authService = mock(AuthService.class);
    private final UUID authenticatedUserId = UUID.randomUUID();
    private final WedgePrincipal authenticatedPrincipal = new WedgePrincipal(authenticatedUserId, "user@example.com", "User");
    private final RefreshCookieProperties refreshCookieProperties = refreshCookieProperties(false);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new AuthController(authService, refreshCookieProperties))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new TestPrincipalArgumentResolver())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void signupReturnsAccessTokenEnvelopeAndHttpOnlyRefreshCookie() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.signup(any())).thenReturn(authTokenIssue(userId, "refresh-token"));

        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_test")
                        .content(objectMapper.writeValueAsString(new SignupPayload(
                                "user@example.com",
                                "password123",
                                "User"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=refresh-token")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("HttpOnly")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("SameSite=Lax")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Path=/api/auth")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Max-Age=604800")))
                .andExpect(jsonPath("$.data.accessToken").value("access-token"))
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.data.user.id").value(userId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value("req_test"));
    }

    @Test
    void loginReturnsAccessTokenEnvelopeAndHttpOnlyRefreshCookie() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.login(any())).thenReturn(authTokenIssue(userId, "login-refresh-token"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginPayload(
                                "user@example.com",
                                "password123"
                        ))))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=login-refresh-token")))
                .andExpect(jsonPath("$.data.accessToken").value("access-token"))
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist());
    }

    @Test
    void refreshReadsHttpOnlyCookieAndRotatesRefreshCookie() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.refresh("old-refresh-token")).thenReturn(authTokenIssue(userId, "new-refresh-token"));

        mockMvc.perform(post("/api/auth/refresh")
                        .cookie(new jakarta.servlet.http.Cookie("wedge_refresh_token", "old-refresh-token")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=new-refresh-token")))
                .andExpect(jsonPath("$.data.accessToken").value("access-token"))
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist());

        verify(authService).refresh("old-refresh-token");
    }

    @Test
    void refreshWithoutCookieReturnsUnauthorizedAndClearsRefreshCookie() throws Exception {
        mockMvc.perform(post("/api/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Max-Age=0")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Path=/api/auth")))
                .andExpect(jsonPath("$.error.code").value("invalid_token"));
    }

    @Test
    void refreshFailureClearsRefreshCookie() throws Exception {
        when(authService.refresh("stale-refresh-token")).thenThrow(new com.wedge.common.error.UnauthorizedException(com.wedge.common.error.ErrorCode.INVALID_TOKEN));

        mockMvc.perform(post("/api/auth/refresh")
                        .cookie(new jakarta.servlet.http.Cookie("wedge_refresh_token", "stale-refresh-token")))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Max-Age=0")))
                .andExpect(jsonPath("$.error.code").value("invalid_token"));
    }

    @Test
    void secureCookieCanBeForcedForProduction() throws Exception {
        UUID userId = UUID.randomUUID();
        AuthController secureController = new AuthController(authService, refreshCookieProperties(true));
        MockMvc secureMockMvc = MockMvcBuilders.standaloneSetup(secureController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new RequestIdFilter())
                .build();
        when(authService.login(any())).thenReturn(authTokenIssue(userId, "secure-refresh-token"));

        secureMockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginPayload(
                                "user@example.com",
                                "password123"
                        ))))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Secure")));
    }

    @Test
    void logoutClearsRefreshCookie() throws Exception {
        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("wedge_refresh_token=")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Max-Age=0")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, not(containsString("refresh-token"))));

        verify(authService).logout(authenticatedUserId);
    }

    @Test
    void validationFailureReturnsErrorMetaEnvelope() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_validation")
                        .content(objectMapper.writeValueAsString(new LoginPayload(
                                "not-an-email",
                                ""
                        ))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"))
                .andExpect(jsonPath("$.error.details.fields").isArray())
                .andExpect(jsonPath("$.meta.requestId").value("req_validation"));
    }


    private RefreshCookieProperties refreshCookieProperties(boolean secure) {
        RefreshCookieProperties properties = new RefreshCookieProperties();
        properties.setSecure(secure);
        return properties;
    }

    private class TestPrincipalArgumentResolver implements HandlerMethodArgumentResolver {
        @Override
        public boolean supportsParameter(MethodParameter parameter) {
            return WedgePrincipal.class.equals(parameter.getParameterType());
        }

        @Override
        public Object resolveArgument(
                MethodParameter parameter,
                ModelAndViewContainer mavContainer,
                NativeWebRequest webRequest,
                WebDataBinderFactory binderFactory
        ) {
            return authenticatedPrincipal;
        }
    }

    private AuthTokenIssue authTokenIssue(UUID userId, String refreshToken) {
        return new AuthTokenIssue(
                new AuthTokenResponse(
                        "access-token",
                        "Bearer",
                        3600,
                        new UserResponse(userId, "user@example.com", "User", "ACTIVE")
                ),
                refreshToken,
                604800
        );
    }

    private record SignupPayload(String email, String password, String displayName) {
    }

    private record LoginPayload(String email, String password) {
    }
}
