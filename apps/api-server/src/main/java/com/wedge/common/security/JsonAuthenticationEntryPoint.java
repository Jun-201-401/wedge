package com.wedge.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.response.ApiError;
import com.wedge.common.response.ApiErrorResponse;
import com.wedge.common.response.RequestMetadata;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class JsonAuthenticationEntryPoint implements AuthenticationEntryPoint {
    private final ObjectMapper objectMapper;

    public JsonAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException {
        write(response, ErrorCode.UNAUTHORIZED);
    }

    void write(HttpServletResponse response, ErrorCode errorCode) throws IOException {
        response.setStatus(errorCode.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        ApiErrorResponse body = new ApiErrorResponse(
                new ApiError(errorCode.code(), errorCode.message(), null),
                RequestMetadata.current()
        );
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
