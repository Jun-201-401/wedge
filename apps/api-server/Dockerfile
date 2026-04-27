FROM eclipse-temurin:17-jdk AS build

WORKDIR /workspace

COPY gradlew gradlew.bat build.gradle settings.gradle ./
COPY gradle ./gradle

RUN chmod +x gradlew

COPY src ./src

RUN ./gradlew bootJar --no-daemon

FROM eclipse-temurin:17-jre

WORKDIR /app

RUN useradd --system --create-home --uid 10001 wedge

COPY --from=build /workspace/build/libs/*.jar /app/app.jar

EXPOSE 8080

USER wedge

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
