package com.wedge.auth.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.auth.api.dto.AuthTokenResponse;
import com.wedge.auth.api.dto.UserResponse;
import com.wedge.auth.application.AuthService;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthControllerTest {
    private final AuthService authService = mock(AuthService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new AuthController(authService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void signupReturnsDataMetaEnvelope() throws Exception {
        UUID userId = UUID.randomUUID();
        when(authService.signup(any())).thenReturn(new AuthTokenResponse(
                "access-token",
                "refresh-token",
                "Bearer",
                3600,
                new UserResponse(userId, "user@example.com", "User", "ACTIVE")
        ));

        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_test")
                        .content(objectMapper.writeValueAsString(new SignupPayload(
                                "user@example.com",
                                "password123",
                                "User"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.accessToken").value("access-token"))
                .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.data.user.id").value(userId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value("req_test"));
    }

    @Test
    void validationFailureReturnsErrorMetaEnvelope() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_validation")
                        .content(objectMapper.writeValueAsString(new LoginPayload(
                                "not-an-email",
                                ""
                        ))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"))
                .andExpect(jsonPath("$.error.details.fields").isArray())
                .andExpect(jsonPath("$.meta.requestId").value("req_validation"));
    }

    private record SignupPayload(String email, String password, String displayName) {
    }

    private record LoginPayload(String email, String password) {
    }
}
