package com.wedge.auth.api;

import com.wedge.auth.api.dto.AuthTokenResponse;
import com.wedge.auth.api.dto.LoginRequest;
import com.wedge.auth.api.dto.RefreshRequest;
import com.wedge.auth.api.dto.SignupRequest;
import com.wedge.auth.api.dto.UserResponse;
import com.wedge.auth.application.AuthService;
import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> signup(@Valid @RequestBody SignupRequest request) {
        return ApiResponse.created(authService.signup(request));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.ok(authService.login(request));
    }

    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> refresh(@Valid @RequestBody RefreshRequest request) {
        return ApiResponse.ok(authService.refresh(request.refreshToken()));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(@AuthenticationPrincipal WedgePrincipal principal) {
        authService.logout(principal.userId());
        return ApiResponse.noData();
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(@AuthenticationPrincipal WedgePrincipal principal) {
        return ApiResponse.ok(authService.me(principal.userId()));
    }
}
