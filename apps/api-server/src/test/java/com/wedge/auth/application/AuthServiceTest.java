package com.wedge.auth.application;

import com.wedge.auth.api.dto.LoginRequest;
import com.wedge.auth.api.dto.SignupRequest;
import com.wedge.auth.domain.UserAccount;
import com.wedge.auth.infrastructure.RefreshTokenRepository;
import com.wedge.auth.infrastructure.UserAccountMapper;
import com.wedge.auth.infrastructure.UserCredentialMapper;
import com.wedge.common.error.UnauthorizedException;
import com.wedge.common.security.JwtTokenProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthServiceTest {
    private final UserAccountMapper userAccountMapper = mock(UserAccountMapper.class);
    private final UserCredentialMapper userCredentialMapper = mock(UserCredentialMapper.class);
    private final RefreshTokenRepository refreshTokenRepository = mock(RefreshTokenRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final JwtTokenProvider jwtTokenProvider = new JwtTokenProvider();
    private AuthService authService;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(jwtTokenProvider, "secret", "test-secret-test-secret-test-secret-test-secret");
        ReflectionTestUtils.setField(jwtTokenProvider, "accessExpirationMillis", 3_600_000L);
        ReflectionTestUtils.setField(jwtTokenProvider, "refreshExpirationMillis", 604_800_000L);
        jwtTokenProvider.initialize();
        authService = new AuthService(
                userAccountMapper,
                userCredentialMapper,
                refreshTokenRepository,
                passwordEncoder,
                jwtTokenProvider
        );
    }

    @Test
    void signupCreatesUserCredentialAndTokens() {
        var response = authService.signup(new SignupRequest("USER@Example.com", "password123", "User"));

        assertThat(response.response().accessToken()).isNotBlank();
        assertThat(response.refreshToken()).isNotBlank();
        assertThat(response.response().tokenType()).isEqualTo("Bearer");
        assertThat(response.response().user().email()).isEqualTo("user@example.com");
        verify(userAccountMapper).insert(any(UserAccount.class));
        verify(refreshTokenRepository).save(any(UUID.class), eq(response.refreshToken()), anyLong());
    }

    @Test
    void loginRejectsWrongPassword() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        when(userAccountMapper.findByAuthSubject("local:user@example.com")).thenReturn(Optional.of(user));
        when(userCredentialMapper.findPasswordHashByUserId(userId)).thenReturn(Optional.of(passwordEncoder.encode("right-password")));

        assertThatThrownBy(() -> authService.login(new LoginRequest("user@example.com", "wrong-password")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void loginRejectsInactiveUser() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "INACTIVE");
        when(userAccountMapper.findByAuthSubject("local:user@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> authService.login(new LoginRequest("user@example.com", "password123")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void refreshRotatesStoredToken() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        String oldRefreshToken = jwtTokenProvider.createRefreshToken(userId, user.getEmail());
        when(userAccountMapper.findById(userId)).thenReturn(Optional.of(user));
        when(refreshTokenRepository.rotateIfMatch(eq(userId), eq(oldRefreshToken), any(), anyLong())).thenReturn(true);

        var response = authService.refresh(oldRefreshToken);

        assertThat(response.refreshToken()).isNotEqualTo(oldRefreshToken);
        verify(refreshTokenRepository).rotateIfMatch(eq(userId), eq(oldRefreshToken), eq(response.refreshToken()), anyLong());
    }

    @Test
    void refreshRejectsTokenForMissingUser() {
        UUID userId = UUID.randomUUID();
        String oldRefreshToken = jwtTokenProvider.createRefreshToken(userId, "deleted@example.com");
        when(userAccountMapper.findById(userId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.refresh(oldRefreshToken))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void refreshRejectsReusedTokenWhenRotationFails() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        String oldRefreshToken = jwtTokenProvider.createRefreshToken(userId, user.getEmail());
        when(userAccountMapper.findById(userId)).thenReturn(Optional.of(user));
        when(refreshTokenRepository.rotateIfMatch(eq(userId), eq(oldRefreshToken), any(), anyLong())).thenReturn(false);

        assertThatThrownBy(() -> authService.refresh(oldRefreshToken))
                .isInstanceOf(UnauthorizedException.class);
    }
}
