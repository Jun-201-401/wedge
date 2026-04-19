package com.wedge.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.response.ApiError;
import com.wedge.common.response.ApiErrorResponse;
import com.wedge.common.response.RequestMetadata;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class JsonAccessDeniedHandler implements AccessDeniedHandler {
    private final ObjectMapper objectMapper;

    public JsonAccessDeniedHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException accessDeniedException)
            throws IOException {
        response.setStatus(ErrorCode.FORBIDDEN.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        ApiErrorResponse body = new ApiErrorResponse(
                new ApiError(ErrorCode.FORBIDDEN.code(), ErrorCode.FORBIDDEN.message(), null),
                RequestMetadata.current()
        );
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
