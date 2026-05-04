package com.wedge.common.security;

import com.wedge.common.error.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class InternalServiceTokenFilter extends OncePerRequestFilter {
    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String SIGNATURE_HEADER = "X-Signature";
    private static final String HMAC_SHA256_ALGORITHM = "HmacSHA256";
    private static final String HMAC_SHA256_PREFIX = "hmac-sha256=";
    private static final List<String> INTERNAL_CALLBACK_PATHS = List.of("/internal/runner/**", "/internal/analysis/**");
    private static final String INTERNAL_RUNNER_CALLBACK_PATH = "/internal/runner/**";

    private final JsonAuthenticationEntryPoint authenticationEntryPoint;
    private final AntPathMatcher pathMatcher = new AntPathMatcher();

    @Value("${wedge.internal.service-token:}")
    private String serviceToken;

    @Value("${wedge.internal.runner-callback-signature-secret:}")
    private String runnerCallbackSignatureSecret;

    public InternalServiceTokenFilter(JsonAuthenticationEntryPoint authenticationEntryPoint) {
        this.authenticationEntryPoint = authenticationEntryPoint;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String authorization = request.getHeader(AUTHORIZATION_HEADER);
        String token = authorization != null && authorization.startsWith(BEARER_PREFIX)
                ? authorization.substring(BEARER_PREFIX.length())
                : null;

        if (serviceToken == null || serviceToken.isBlank() || token == null || !matchesServiceToken(token)) {
            SecurityContextHolder.clearContext();
            authenticationEntryPoint.write(response, ErrorCode.UNAUTHORIZED);
            return;
        }

        HttpServletRequest requestToFilter = request;
        if (isInternalRunnerCallback(request)) {
            byte[] body = request.getInputStream().readAllBytes();
            if (!matchesRunnerCallbackSignature(request.getHeader(SIGNATURE_HEADER), body)) {
                SecurityContextHolder.clearContext();
                authenticationEntryPoint.write(response, ErrorCode.UNAUTHORIZED);
                return;
            }
            requestToFilter = new CachedBodyHttpServletRequest(request, body);
        }

        UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                "internal-runner",
                null,
                List.of(new SimpleGrantedAuthority("ROLE_INTERNAL_RUNNER"))
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);
        filterChain.doFilter(requestToFilter, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI();
        return INTERNAL_CALLBACK_PATHS.stream().noneMatch(pattern -> pathMatcher.match(pattern, path));
    }

    private boolean matchesServiceToken(String token) {
        return MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                serviceToken.getBytes(StandardCharsets.UTF_8)
        );
    }

    private boolean isInternalRunnerCallback(HttpServletRequest request) {
        return pathMatcher.match(INTERNAL_RUNNER_CALLBACK_PATH, request.getRequestURI());
    }

    private boolean matchesRunnerCallbackSignature(String providedSignature, byte[] body) {
        if (!StringUtils.hasText(runnerCallbackSignatureSecret)) {
            return true;
        }
        if (!StringUtils.hasText(providedSignature)) {
            return false;
        }

        byte[] expected = hmacSha256Hex(body, runnerCallbackSignatureSecret).getBytes(StandardCharsets.UTF_8);
        byte[] actual = normalizeSignature(providedSignature).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(actual, expected);
    }

    private String normalizeSignature(String signature) {
        String trimmed = signature.trim();
        if (trimmed.regionMatches(true, 0, HMAC_SHA256_PREFIX, 0, HMAC_SHA256_PREFIX.length())) {
            return trimmed.substring(HMAC_SHA256_PREFIX.length());
        }
        return trimmed;
    }

    private String hmacSha256Hex(byte[] body, String secret) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256_ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256_ALGORITHM));
            return toHex(mac.doFinal(body));
        } catch (NoSuchAlgorithmException | InvalidKeyException exception) {
            throw new IllegalStateException("Runner callback signature verifier could not initialize HMAC-SHA256.", exception);
        }
    }

    private String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private static class CachedBodyHttpServletRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedBodyHttpServletRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream inputStream = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return inputStream.read();
                }

                @Override
                public boolean isFinished() {
                    return inputStream.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener readListener) {
                    throw new UnsupportedOperationException("Async reads are not supported for cached callback bodies.");
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            Charset charset = getCharacterEncoding() == null
                    ? StandardCharsets.UTF_8
                    : Charset.forName(getCharacterEncoding());
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }
}
