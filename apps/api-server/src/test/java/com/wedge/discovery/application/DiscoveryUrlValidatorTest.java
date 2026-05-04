package com.wedge.discovery.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import java.net.URI;
import org.junit.jupiter.api.Test;

class DiscoveryUrlValidatorTest {
    private final DiscoveryUrlValidator validator = new DiscoveryUrlValidator();

    @Test
    void rejectsNonHttpSchemes() {
        assertThatThrownBy(() -> validator.validate(URI.create("file:///etc/passwd")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery url must use http or https.");
    }

    @Test
    void rejectsLocalhostHostsBeforeResolution() {
        assertThatThrownBy(() -> validator.validate(URI.create("http://localhost:8080")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery url host is not allowed.");
    }

    @Test
    void rejectsPrivateResolvedAddresses() {
        assertThatThrownBy(() -> validator.validate(URI.create("http://127.0.0.1")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery url host resolves to a private or reserved address.");
    }

    @Test
    void rejectsUserInfo() {
        assertThatThrownBy(() -> validator.validate(URI.create("https://user@example.com")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery url must not include user info.");
    }
}
