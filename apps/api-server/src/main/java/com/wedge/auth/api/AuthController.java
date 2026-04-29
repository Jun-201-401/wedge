package com.wedge.auth.api;

import com.wedge.auth.api.dto.AuthTokenResponse;
import com.wedge.auth.api.dto.LoginRequest;
import com.wedge.auth.api.dto.SignupRequest;
import com.wedge.auth.api.dto.UserResponse;
import com.wedge.auth.application.AuthService;
import com.wedge.auth.application.AuthTokenIssue;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.error.UnauthorizedException;
import com.wedge.common.response.ApiErrorResponse;
import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final String REFRESH_TOKEN_COOKIE_NAME = "wedge_refresh_token";

    private final AuthService authService;
    private final RefreshCookieProperties refreshCookieProperties;

    public AuthController(AuthService authService, RefreshCookieProperties refreshCookieProperties) {
        this.authService = authService;
        this.refreshCookieProperties = refreshCookieProperties;
    }

    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> signup(
            @Valid @RequestBody SignupRequest request,
            HttpServletRequest servletRequest
    ) {
        AuthTokenIssue tokenIssue = authService.signup(request);
        return tokenResponse(tokenIssue, HttpStatus.CREATED, servletRequest);
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest
    ) {
        AuthTokenIssue tokenIssue = authService.login(request);
        return tokenResponse(tokenIssue, HttpStatus.OK, servletRequest);
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(
            @CookieValue(name = REFRESH_TOKEN_COOKIE_NAME, required = false) String refreshToken,
            HttpServletRequest servletRequest
    ) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return invalidRefreshTokenResponse(servletRequest);
        }

        try {
            AuthTokenIssue tokenIssue = authService.refresh(refreshToken);
            return tokenResponse(tokenIssue, HttpStatus.OK, servletRequest);
        } catch (UnauthorizedException exception) {
            return invalidRefreshTokenResponse(servletRequest);
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(
            @AuthenticationPrincipal WedgePrincipal principal,
            HttpServletRequest servletRequest
    ) {
        authService.logout(principal.userId());
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, expiredRefreshCookie(servletRequest).toString())
                .body(ApiResponse.body(null));
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(@AuthenticationPrincipal WedgePrincipal principal) {
        return ApiResponse.ok(authService.me(principal.userId()));
    }

    private ResponseEntity<ApiResponse<AuthTokenResponse>> tokenResponse(
            AuthTokenIssue tokenIssue,
            HttpStatus status,
            HttpServletRequest servletRequest
    ) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, refreshCookie(tokenIssue, servletRequest).toString())
                .body(ApiResponse.body(tokenIssue.response()));
    }

    private ResponseCookie refreshCookie(AuthTokenIssue tokenIssue, HttpServletRequest servletRequest) {
        return ResponseCookie.from(REFRESH_TOKEN_COOKIE_NAME, tokenIssue.refreshToken())
                .httpOnly(true)
                .secure(isSecureRequest(servletRequest))
                .sameSite(refreshCookieProperties.sameSite())
                .path(refreshCookieProperties.path())
                .maxAge(Duration.ofSeconds(tokenIssue.refreshExpiresInSeconds()))
                .build();
    }

    private ResponseCookie expiredRefreshCookie(HttpServletRequest servletRequest) {
        return ResponseCookie.from(REFRESH_TOKEN_COOKIE_NAME, "")
                .httpOnly(true)
                .secure(isSecureRequest(servletRequest))
                .sameSite(refreshCookieProperties.sameSite())
                .path(refreshCookieProperties.path())
                .maxAge(Duration.ZERO)
                .build();
    }

    private ResponseEntity<ApiErrorResponse> invalidRefreshTokenResponse(HttpServletRequest servletRequest) {
        ResponseEntity<ApiErrorResponse> errorResponse = ApiErrorResponse.of(ErrorCode.INVALID_TOKEN);
        return ResponseEntity.status(errorResponse.getStatusCode())
                .header(HttpHeaders.SET_COOKIE, expiredRefreshCookie(servletRequest).toString())
                .body(errorResponse.getBody());
    }

    private boolean isSecureRequest(HttpServletRequest servletRequest) {
        return refreshCookieProperties.secure()
                || servletRequest.isSecure()
                || "https".equalsIgnoreCase(servletRequest.getHeader("X-Forwarded-Proto"));
    }
}
