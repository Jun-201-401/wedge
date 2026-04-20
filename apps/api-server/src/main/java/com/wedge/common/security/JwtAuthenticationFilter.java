package com.wedge.common.security;

import com.wedge.auth.domain.UserAccount;
import com.wedge.auth.infrastructure.UserAccountMapper;
import com.wedge.common.error.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String ACTIVE_STATUS = "ACTIVE";
    private static final List<String> HUMAN_JWT_PATHS = List.of(
            "/api/auth/logout",
            "/api/auth/me",
            "/api/runs",
            "/api/runs/**"
    );

    private final JwtTokenProvider jwtTokenProvider;
    private final UserAccountMapper userAccountMapper;
    private final JsonAuthenticationEntryPoint authenticationEntryPoint;
    private final AntPathMatcher pathMatcher = new AntPathMatcher();

    public JwtAuthenticationFilter(
            JwtTokenProvider jwtTokenProvider,
            UserAccountMapper userAccountMapper,
            JsonAuthenticationEntryPoint authenticationEntryPoint
    ) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.userAccountMapper = userAccountMapper;
        this.authenticationEntryPoint = authenticationEntryPoint;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String token = jwtTokenProvider.extractBearerToken(request.getHeader(AUTHORIZATION_HEADER));
        if (token == null) {
            authenticationEntryPoint.write(response, ErrorCode.UNAUTHORIZED);
            return;
        }

        WedgePrincipal principal;
        try {
            JwtTokenProvider.AccessTokenPayload payload = jwtTokenProvider.parseAccessToken(token);
            UserAccount user = userAccountMapper.findById(payload.userId()).orElse(null);
            if (user == null || !ACTIVE_STATUS.equals(user.getStatus())) {
                authenticationEntryPoint.write(response, ErrorCode.INVALID_TOKEN);
                return;
            }
            principal = new WedgePrincipal(user.getId(), user.getEmail(), user.getDisplayName());
        } catch (Exception exception) {
            SecurityContextHolder.clearContext();
            authenticationEntryPoint.write(response, ErrorCode.INVALID_TOKEN);
            return;
        }

        UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                principal,
                null,
                principal.getAuthorities()
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);
        filterChain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI();
        return HUMAN_JWT_PATHS.stream().noneMatch(pattern -> pathMatcher.match(pattern, path));
    }
}
