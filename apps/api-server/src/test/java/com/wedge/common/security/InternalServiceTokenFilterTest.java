package com.wedge.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

class InternalServiceTokenFilterTest {
    private InternalServiceTokenFilter filter;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        filter = new InternalServiceTokenFilter(new JsonAuthenticationEntryPoint(new ObjectMapper()));
        ReflectionTestUtils.setField(filter, "serviceToken", "internal-token");
        ReflectionTestUtils.setField(filter, "runnerCallbackSignatureSecret", "signature-secret");
    }

    @Test
    void internalCallbackPathsAlwaysRequireInternalTokenFilter() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/internal/analysis/jobs/analysis-id/completed");

        assertThat(filter.shouldNotFilter(request)).isFalse();
    }

    @Test
    void publicApiPathsDoNotUseInternalTokenFilter() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/runs/run-id/evidence-packet");
        request.addHeader("Authorization", "Bearer internal-token");

        assertThat(filter.shouldNotFilter(request)).isTrue();
    }

    @Test
    void runnerCallbackAcceptsValidHmacSignatureAndKeepsBodyReadable() throws Exception {
        String body = "{\"workerId\":\"runner_001\"}";
        MockHttpServletRequest request = runnerRequest(body, "hmac-sha256=" + hmacSha256Hex(body, "signature-secret"));
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> forwardedBody = new AtomicReference<>();

        filter.doFilter(request, response, (ServletRequest servletRequest, ServletResponse servletResponse) ->
                forwardedBody.set(servletRequest.getReader().readLine())
        );

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(forwardedBody.get()).isEqualTo(body);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                .extracting("authority")
                .containsExactly("ROLE_INTERNAL_RUNNER");
    }

    @Test
    void runnerCallbackRejectsInvalidHmacSignature() throws Exception {
        MockHttpServletRequest request = runnerRequest("{\"workerId\":\"runner_001\"}", "hmac-sha256=invalid");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainCalled = new AtomicBoolean(false);

        filter.doFilter(request, response, (servletRequest, servletResponse) -> chainCalled.set(true));

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(chainCalled.get()).isFalse();
    }

    @Test
    void analyzerCallbacksDoNotUseRunnerSignatureSecret() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/internal/analysis/jobs/analysis-id/completed");
        request.addHeader("Authorization", "Bearer internal-token");
        request.addHeader("X-Signature", "hmac-sha256=analyzer-owned-signature");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainCalled = new AtomicBoolean(false);

        filter.doFilter(request, response, (servletRequest, servletResponse) -> chainCalled.set(true));

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(chainCalled.get()).isTrue();
    }

    private MockHttpServletRequest runnerRequest(String body, String signature) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/internal/runner/runs/run-id/accepted");
        request.addHeader("Authorization", "Bearer internal-token");
        request.addHeader("X-Signature", signature);
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        return request;
    }

    private String hmacSha256Hex(String body, String secret) throws NoSuchAlgorithmException, InvalidKeyException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder(digest.length * 2);
        for (byte value : digest) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }
}
