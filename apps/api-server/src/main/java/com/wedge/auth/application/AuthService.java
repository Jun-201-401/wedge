package com.wedge.auth.application;

import com.wedge.auth.api.dto.AuthTokenResponse;
import com.wedge.auth.api.dto.LoginRequest;
import com.wedge.auth.api.dto.SignupRequest;
import com.wedge.auth.api.dto.UserResponse;
import com.wedge.auth.domain.UserAccount;
import com.wedge.auth.domain.UserCredential;
import com.wedge.auth.infrastructure.RefreshTokenRepository;
import com.wedge.auth.infrastructure.UserAccountMapper;
import com.wedge.auth.infrastructure.UserCredentialMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.error.UnauthorizedException;
import com.wedge.common.security.JwtTokenProvider;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {
    private static final String ACTIVE = "ACTIVE";
    private static final String TOKEN_TYPE = "Bearer";

    private final UserAccountMapper userAccountMapper;
    private final UserCredentialMapper userCredentialMapper;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    public AuthService(
            UserAccountMapper userAccountMapper,
            UserCredentialMapper userCredentialMapper,
            RefreshTokenRepository refreshTokenRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenProvider jwtTokenProvider
    ) {
        this.userAccountMapper = userAccountMapper;
        this.userCredentialMapper = userCredentialMapper;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Transactional
    public AuthTokenResponse signup(SignupRequest request) {
        String normalizedEmail = normalizeEmail(request.email());
        UserAccount user = new UserAccount(
                UUID.randomUUID(),
                localAuthSubject(normalizedEmail),
                normalizedEmail,
                request.displayName().trim(),
                ACTIVE
        );
        try {
            userAccountMapper.insert(user);
            userCredentialMapper.insert(new UserCredential(user.getId(), passwordEncoder.encode(request.password())));
        } catch (DuplicateKeyException exception) {
            throw new BusinessException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }
        return issueTokens(user, null);
    }

    @Transactional
    public AuthTokenResponse login(LoginRequest request) {
        UserAccount user = userAccountMapper.findByAuthSubject(localAuthSubject(normalizeEmail(request.email())))
                .orElseThrow(() -> new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS));
        ensureActive(user);
        String passwordHash = userCredentialMapper.findPasswordHashByUserId(user.getId())
                .orElseThrow(() -> new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS));
        if (!passwordEncoder.matches(request.password(), passwordHash)) {
            throw new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS);
        }
        return issueTokens(user, null);
    }

    @Transactional
    public AuthTokenResponse refresh(String refreshToken) {
        if (!jwtTokenProvider.validateRefreshToken(refreshToken)) {
            throw new UnauthorizedException(ErrorCode.INVALID_TOKEN);
        }
        UUID userId = jwtTokenProvider.getUserIdFromRefreshToken(refreshToken);
        UserAccount user = getUser(userId);
        ensureActive(user);
        return issueTokens(user, refreshToken);
    }

    @Transactional
    public void logout(UUID userId) {
        refreshTokenRepository.deleteByUserId(userId);
    }

    @Transactional(readOnly = true)
    public UserResponse me(UUID userId) {
        UserAccount user = getUser(userId);
        ensureActive(user);
        return UserResponse.from(user);
    }

    private AuthTokenResponse issueTokens(UserAccount user, String previousRefreshToken) {
        String accessToken = jwtTokenProvider.createAccessToken(user.getId(), user.getEmail(), user.getDisplayName());
        String refreshToken = jwtTokenProvider.createRefreshToken(user.getId(), user.getEmail());
        if (previousRefreshToken == null) {
            refreshTokenRepository.save(user.getId(), refreshToken, jwtTokenProvider.refreshExpirationMillis());
        } else if (!refreshTokenRepository.rotateIfMatch(
                user.getId(),
                previousRefreshToken,
                refreshToken,
                jwtTokenProvider.refreshExpirationMillis()
        )) {
            throw new UnauthorizedException(ErrorCode.INVALID_TOKEN);
        }
        return new AuthTokenResponse(
                accessToken,
                refreshToken,
                TOKEN_TYPE,
                jwtTokenProvider.accessExpirationSeconds(),
                UserResponse.from(user)
        );
    }

    private UserAccount getUser(UUID userId) {
        return userAccountMapper.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    private void ensureActive(UserAccount user) {
        if (!ACTIVE.equals(user.getStatus())) {
            throw new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS);
        }
    }

    private String localAuthSubject(String normalizedEmail) {
        return "local:" + normalizedEmail;
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
