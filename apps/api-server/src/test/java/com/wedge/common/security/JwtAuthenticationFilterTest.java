package com.wedge.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.auth.domain.UserAccount;
import com.wedge.auth.infrastructure.UserAccountMapper;
import com.wedge.common.response.RequestMetadata;
import jakarta.servlet.ServletException;
import java.io.IOException;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class JwtAuthenticationFilterTest {
    private final JwtTokenProvider jwtTokenProvider = new JwtTokenProvider();
    private final UserAccountMapper userAccountMapper = mock(UserAccountMapper.class);
    private final JsonAuthenticationEntryPoint entryPoint = new JsonAuthenticationEntryPoint(new ObjectMapper());
    private JwtAuthenticationFilter filter;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(jwtTokenProvider, "secret", "test-secret-test-secret-test-secret-test-secret");
        ReflectionTestUtils.setField(jwtTokenProvider, "accessExpirationMillis", 3_600_000L);
        ReflectionTestUtils.setField(jwtTokenProvider, "refreshExpirationMillis", 604_800_000L);
        jwtTokenProvider.initialize();
        filter = new JwtAuthenticationFilter(jwtTokenProvider, userAccountMapper, entryPoint);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void missingTokenReturnsUnauthorizedEnvelopeWithRequestId() throws ServletException, IOException {
        MockHttpServletRequest request = authMeRequest();
        request.setAttribute(RequestMetadata.REQUEST_ID_ATTRIBUTE, "req_security");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("\"code\":\"unauthorized\"");
        assertThat(response.getContentAsString()).contains("\"requestId\":\"req_security\"");
    }

    @Test
    void downstreamExceptionsAreNotConvertedToInvalidToken() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        when(userAccountMapper.findById(userId)).thenReturn(Optional.of(user));
        MockHttpServletRequest request = authMeRequest();
        request.addHeader(
                "Authorization",
                "Bearer " + jwtTokenProvider.createAccessToken(userId, user.getEmail(), user.getDisplayName())
        );
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> filter.doFilter(request, response, (servletRequest, servletResponse) -> {
            throw new IllegalStateException("downstream failure");
        })).isInstanceOf(IllegalStateException.class)
                .hasMessage("downstream failure");
    }

    @Test
    void reportApiPathsRequireJwtFilter() throws ServletException {
        assertThat(filter.shouldNotFilter(request("/api/reports"))).isFalse();
        assertThat(filter.shouldNotFilter(request("/api/reports/018f4c1d-14c0-7f2b-8d76-97f2fa99aa01"))).isFalse();
    }

    private MockHttpServletRequest authMeRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/auth/me");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        return request;
    }

    private MockHttpServletRequest request(String path) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setRequestURI(path);
        return request;
    }
}
