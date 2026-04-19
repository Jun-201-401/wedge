package com.wedge.auth.infrastructure;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Repository
public class RefreshTokenRepository {
    private static final String KEY_PREFIX = "refresh_token:";
    private static final DefaultRedisScript<Long> ROTATE_IF_MATCH_SCRIPT = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                    "redis.call('set', KEYS[1], ARGV[2], 'px', ARGV[3]); " +
                    "return 1 else return 0 end",
            Long.class
    );

    private final StringRedisTemplate redisTemplate;

    public RefreshTokenRepository(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void save(UUID userId, String refreshToken, long ttlMillis) {
        requireToken(refreshToken);
        redisTemplate.opsForValue().set(key(userId), refreshToken, ttlMillis, TimeUnit.MILLISECONDS);
    }

    public boolean rotateIfMatch(UUID userId, String expectedToken, String newToken, long ttlMillis) {
        requireToken(expectedToken);
        requireToken(newToken);
        Long result = redisTemplate.execute(
                ROTATE_IF_MATCH_SCRIPT,
                Collections.singletonList(key(userId)),
                expectedToken,
                newToken,
                String.valueOf(ttlMillis)
        );
        return Long.valueOf(1L).equals(result);
    }

    public void deleteByUserId(UUID userId) {
        redisTemplate.delete(key(userId));
    }

    private String key(UUID userId) {
        return KEY_PREFIX + userId;
    }

    private void requireToken(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
    }
}
