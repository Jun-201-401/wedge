package com.wedge.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

class InternalServiceTokenFilterTest {
    private InternalServiceTokenFilter filter;

    @BeforeEach
    void setUp() {
        filter = new InternalServiceTokenFilter(new JsonAuthenticationEntryPoint(new ObjectMapper()));
        ReflectionTestUtils.setField(filter, "serviceToken", "internal-token");
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
}
